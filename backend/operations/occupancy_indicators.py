"""Oracle Informative Indicators with dated production bed-capacity photographs."""
import hashlib
import json
from calendar import monthrange
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from operations.models import ReportDefinition, ReportSnapshotRun, ReportSnapshotDataRow
from operations.report_engine import connect, parameters, run_query, sql_contract
from operations.occupancy_calculations import occupancy, series_averages, selected_dates

HANDLER = "occupancy_indicators_v1"
SOURCES = {"patients":"occupancy-patients-production", "attendances":"occupancy-attendances-production",
           "surgeries":"occupancy-surgeries-production"}
OVERVIEW = ["Período", "Média pacientes", "Média leitos", "Ocupação (%)", "Estado"]
SERIES = ["Período", "SUS", "Sansaúde", "Convênio", "Particular", "Iamspe", "Total"]
DATASETS = {"metadata":["referencia","consultado_em","capacidade_ate","lacunas"],
            "general":OVERVIEW,"sus":OVERVIEW,"convenio":OVERVIEW,"sectors":lambda ref:sector_columns(ref),
            "attendances":["Período","PS Convênio","PS SUS","PA G.O.","PA Pediatria","PS Isolamento","Total"],
            "elective":SERIES,"urgent":SERIES,"surgeries":SERIES}


def fail(message):
    raise ValidationError(message)


def sources(report):
    if report.unit.slug != "scv" or report.code != "legacy123-20" or report.source != "composite":
        fail("Definição dos Indicadores Informativos incompatível.")
    output = {}
    for part, code in SOURCES.items():
        r = ReportDefinition.objects.select_related("connection","unit").filter(
            unit=report.unit, code=code, catalog_kind="component", source="sql",
            enabled=True, reviewed=True, review_queue=False).first()
        c = r.connection if r else None
        if (not c or c.unit_id != report.unit_id or c.engine != "oracle" or not c.enabled
                or not c.validated or c.host != "172.16.0.254" or c.database.lower() != "prdvotu"):
            fail("Configure as fontes Oracle de produção dos Indicadores Informativos.")
        if set(r.parameter_schema)!={"inicio","fim_exclusivo"} or any(r.parameter_schema[k].get("type")!="date" or not r.parameter_schema[k].get("required",True) for k in r.parameter_schema):
            fail("Revise o contrato de datas dos componentes de ocupação.")
        sql_contract(r.query_sql, r.parameter_schema, "oracle")
        output[part] = r
    ids = {r.connection_id for r in output.values()}
    if len(ids) != 1 or report.connection_id not in ids:
        fail("Todas as fontes devem usar a mesma conexão Oracle de produção.")
    return output


def capacity_runs(report):
    return ReportSnapshotRun.objects.filter(unit=report.unit,
        configuration__code="bed-capacity-daily", configuration__dataset_kind="capacity",
        period_type="day", state="ready", origin="legacy",
        source_snapshot__kind="legacy_import", source_snapshot__environment="production",
        source_snapshot__source_host="172.16.0.123",
        source_snapshot__source_table="LEITOS_DISPONIVEIS").order_by("reference_date","pk")


def history_records(report):
    return ReportSnapshotDataRow.objects.filter(unit=report.unit,run__in=capacity_runs(report)).order_by(
        "run__reference_date","run_id","record_key").values("run_id","run__reference_date","run__row_count","record_key","payload")


def definition_snapshot(report):
    children = sources(report)
    history = list(history_records(report))
    if not history:
        fail("Não há capacidade histórica de produção aprovada.")
    return {"version":1,"environment":"production",
        "sources":{k:{"id":r.pk,"version":r.version,"sql_sha256":hashlib.sha256(r.query_sql.encode()).hexdigest(),
            "connection":r.connection_id,"connection_version":r.connection.version} for k,r in children.items()},
        "capacity_sha256":hashlib.sha256(json.dumps(history,sort_keys=True,default=str).encode()).hexdigest()}


def prepare_values(report, values, *, origin="panel", recipient=None):
    if origin not in {"panel","whatsapp"}:
        raise PermissionDenied("Programação automática de Informativos ainda não homologada.")
    ref = parameters(report, values).get("data_referencia")
    today = timezone.localtime(timezone.now(),ZoneInfo(report.unit.timezone)).date()
    ref = ref or today
    if ref < date(2026,1,1) or ref > today:
        fail("Informe uma referência entre 01/01/2026 e hoje.")
    return {"data_referencia":ref.isoformat()}


def sector_columns(ref):
    return ["Setor",*[p["label"] for p in periods(ref) if p["kind"] in {"month","day"}],"Atual (%)","Leitos"]


def integer(value, *, signed=False):
    try:
        n = Decimal(str(value))
        if not n.is_finite() or n != n.to_integral_value() or (n < 0 and not signed):
            raise ValueError()
        return int(n)
    except (ValueError,TypeError,InvalidOperation):
        fail("Agregado inválido na fonte dos indicadores.")


def day(value):
    if isinstance(value,datetime):
        return value.date()
    if isinstance(value,date):
        return value
    return date.fromisoformat(str(value)[:10])


def periods(ref):
    chosen = selected_dates(ref)
    result = []
    def add(kind, start, end, label):
        result.append({"kind":kind,"start":start,"end":end,"label":label,"days":(end-start).days})
    for year in chosen["annual_years"]:
        add("year",date(year,1,1),min(date(year+1,1,1),ref),str(year))
    names=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"]
    for month in chosen["months"]:
        end=month+timedelta(days=monthrange(month.year,month.month)[1])
        add("month",month,min(end,ref),f"{names[month.month-1]}/{month.year%100:02d}")
    for d in chosen["days"]:
        add("day",d,d+timedelta(days=1),d.strftime("%d/%m"))
    return result


def parse_capacity(records):
    capacity={};names={};runs={};counts=defaultdict(int);expected={}
    for record in records:
        p=record["payload"];d=record["run__reference_date"]
        run=str(record["run_id"])
        if d in runs and runs[d] != run:
            fail("Mais de uma fotografia de capacidade na mesma data; revise a origem.")
        runs[d]=run
        counts[run]+=1
        if "run__row_count" in record:expected[run]=record["run__row_count"]
        code=integer(p.get("ward_code"))
        if code < 1 or str(code)!=record["record_key"] or p.get("date")!=d.isoformat():
            fail("Identidade/data incompatível na capacidade histórica.")
        sus,conv,total=(integer(p.get(k)) for k in ["sus","convenio","total"])
        if sus+conv!=total or (d,code) in capacity:
            fail("Rateio de capacidade inválido ou duplicado.")
        name=p.get("ward_name")
        if not isinstance(name,str) or not name.strip():
            fail("Setor da capacidade não identificado.")
        capacity[d,code]={"sus":sus,"convenio":conv,"general":total}
        names[code]=name.strip()
    if any(counts[k]!=v for k,v in expected.items()):
        fail("Fotografia de capacidade incompleta; revise os registros preservados.")
    return capacity,names,set(runs)


def build_tables(ref, raw, capacity_records, *, consulted_at):
    capacity,names,observed_dates=parse_capacity([r for r in capacity_records if r["run__reference_date"]<ref])
    ps=periods(ref);keys={(p["kind"],p["start"]) for p in ps}
    patient=defaultdict(int);attendance=defaultdict(lambda:defaultdict(int));surgery=defaultdict(lambda:defaultdict(int))
    for part, expected in [("patients",["KIND","PERIOD","WARD_CODE","WARD_NAME","INSURANCE","TOTAL","LAST_SOURCE_DATE"]),
          ("attendances",["KIND","PERIOD","ORIGIN","TOTAL","LAST_SOURCE_DATE"]),
          ("surgeries",["KIND","PERIOD","INSURANCE","SURGERY_TYPE","TOTAL","LAST_SOURCE_DATE"])]:
        columns,rows=raw[part]
        if columns != expected:
            fail("Colunas incompatíveis no componente de indicadores: "+part)
        seen=set()
        for values in rows:
            row=dict(zip(columns,values));k=(row["KIND"],day(row["PERIOD"]))
            # Sources may include intermediate months outside the displayed 13-month window.
            if k not in keys:
                continue
            if part=="patients":
                code=integer(row["WARD_CODE"]);insurance=row["INSURANCE"]
                identity=(*k,code,insurance)
                if insurance not in {"SUS","CONVENIO","PARTICULAR",None,""}:
                    fail("Classificação de convênio inesperada na ocupação.")
                name=str(row["WARD_NAME"]).strip()
                if code not in names:names[code]=name
                patient[(*k,code,insurance)]+=integer(row["TOTAL"],signed=True)
            elif part=="attendances":
                identity=(*k,row["ORIGIN"])
                attendance[k][row["ORIGIN"]]+=integer(row["TOTAL"])
            else:
                identity=(*k,row["INSURANCE"],row["SURGERY_TYPE"])
                if row["INSURANCE"] not in {"SUS","SANSAUDE","CONVENIO","PARTICULAR","IAMSPE"}:
                    fail("Classificação de convênio inesperada nas cirurgias.")
                amount=integer(row["TOTAL"])
                for category in ["surgeries",*( ["elective"] if row["SURGERY_TYPE"]=="E" else ["urgent"] if row["SURGERY_TYPE"] in {"U","M"} else [])]:
                    surgery[k,category][row["INSURANCE"]]+=amount
            if identity in seen:fail("Agregados duplicados na fonte Oracle.")
            seen.add(identity)
    tables={}
    def rates(p,group,code=None):
        if p["days"]<=0:return {"patients":None,"capacity":None,"rate":None,"status":"empty_period"}
        dates={p["start"]+timedelta(days=i) for i in range(p["days"])}
        insurance={"SUS"} if group=="sus" else {"CONVENIO","PARTICULAR"} if group=="convenio" else {"SUS","CONVENIO","PARTICULAR"}
        value=sum(v for (kind,start,ward,ins),v in patient.items() if (kind,start)==(p["kind"],p["start"]) and ins in insurance and (code is None or ward==code))
        beds=sum(v[group] for (d,ward),v in capacity.items() if d in dates and (code is None or ward==code))
        return occupancy(value,beds,p["days"],capacity_complete=dates<=observed_dates)
    states={"ok":"Completo","capacity_missing":"Capacidade não carregada","capacity_zero":"Capacidade zero","empty_period":"Período sem dias decorridos"}
    for group in ["general","sus","convenio"]:
        tables[group]=(OVERVIEW,[[p["label"],r["patients"],r["capacity"],r["rate"],states[r["status"]]] for p in ps for r in [rates(p,group)]])
    monthdays=[p for p in ps if p["kind"]!="year"]
    last=ps[-1]
    tables["sectors"]=(sector_columns(ref),
        [[names[code],*[rates(p,"general",code)["rate"] for p in monthdays],rates(last,"general",code)["rate"],rates(last,"general",code)["capacity"]] for code in sorted(names)])
    for part in ["attendances","elective","urgent","surgeries"]:
        result=[]
        for p in ps:
            # Legacy annual event means use a fixed 365 for a previous year.
            divisor=365 if p["kind"]=="year" and p["start"].year<ref.year else p["days"]
            if divisor<=0:
                values=[None]*6
            else:
                totals=attendance[p["kind"],p["start"]] if part=="attendances" else surgery[(p["kind"],p["start"]),part]
                avg=series_averages(totals,divisor,kind="attendances" if part=="attendances" else "surgeries")
                values=[*avg["values"],avg["total"]]
            result.append([p["label"],*values])
        tables[part]=(DATASETS[part],result)
    first=date(ref.year-1,1,1)
    missing=[first+timedelta(days=i) for i in range((ref-first).days) if first+timedelta(days=i) not in observed_dates]
    tables["metadata"]=(DATASETS["metadata"],[[ref.isoformat(),consulted_at,
        max(d for d in observed_dates if d<ref).isoformat() if any(d<ref for d in observed_dates) else "Indisponível",
        (str(len(missing))+" data(s): "+", ".join(d.strftime("%d/%m/%Y") for d in missing[-12:])+(" (últimas)" if len(missing)>12 else "")) if missing else "Nenhuma"]])
    if not any(rows for _,rows in raw.values()):
        return {k:(v[0],[]) for k,v in tables.items()}
    return tables


def collect(report,values):
    ref=date.fromisoformat(prepare_values(report,values)["data_referencia"])
    children=sources(report);raw={}
    with connect(children["patients"].connection) as db:
        for part,child in children.items():
            raw[part]=run_query(child,{"inicio":date(ref.year-1,1,1).isoformat(),"fim_exclusivo":ref.isoformat()},session=db,typed=True)
    return build_tables(ref,raw,list(history_records(report)),consulted_at=timezone.localtime(timezone.now(),ZoneInfo(report.unit.timezone)).isoformat())
