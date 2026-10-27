from dataclasses import dataclass
import hashlib
import json
from rest_framework.exceptions import ValidationError
from operations.models import ReportDefinition
from operations.report_engine import run_query, sql_contract
from .registry import SOURCES
from .schema import fail

@dataclass
class Dataset:
    columns: list
    rows: list


def resolve_report(owner, spec):
    child=ReportDefinition.objects.filter(pk=spec["report_id"],unit=owner.unit,reviewed=True,review_queue=False).select_related("connection","unit").first()
    if not child or (not child.enabled and child.pk!=owner.pk):fail("Fonte indisponível nesta unidade.")
    from .native import datasets
    native=datasets(child)
    dataset=spec.get("dataset","rows")
    if native:
        if dataset not in native:fail("Conjunto de dados não disponível para este relatório.")
        return child
    if child.source!="sql" or not child.connection_id or child.connection.unit_id != owner.unit_id or not child.connection.enabled or not child.connection.validated:
        fail("Fonte SQL indisponível nesta unidade.")
    if spec.get("dataset"):fail("Consulta SQL não possui este conjunto de dados.")
    from operations.report_parameters import normalized_schema
    child.parameter_schema=normalized_schema(child.parameter_schema)
    sql_contract(child.query_sql,child.parameter_schema,child.connection.engine)
    return child


def signature(child):
    from .native import datasets,manifest
    payload={"sql":child.query_sql,"schema":child.parameter_schema,"version":child.version,"connection":child.connection_id,"connection_version":child.connection.version if child.connection_id else None,"handler":child.handler}
    if datasets(child):payload["native"]=manifest(child)
    return hashlib.sha256(json.dumps(payload,sort_keys=True).encode()).hexdigest()


class InlineSource:
    def validate(self,s):
        cols=s.get("columns");rows=s.get("rows")
        if not isinstance(cols,list) or not 1<=len(cols)<=100 or any(not isinstance(c,str) or not c or len(c)>100 for c in cols) or len(set(cols))!=len(cols) or not isinstance(rows,list) or len(rows)>2000:
            fail("Colunas ou linhas da fonte manual inválidas.")
        for r in rows:
            if not isinstance(r,list) or len(r)!=len(cols) or any(type(v) not in (str,int,float,bool,type(None)) or (isinstance(v,str) and len(v)>2000) for v in r):
                fail("Linha da fonte manual inválida.")
    def read(self,context,s): return Dataset(s["columns"],s["rows"])

class GoalsSource:
    def validate(self,s): pass
    def read(self,context,s):
        return Dataset(["year","month","value"],[[r["year"],r["month"],r["value"]] for r in context.goals])

class ReportSource:
    def validate(self,s):
        if "dataset" in s and (not isinstance(s["dataset"],str) or not s["dataset"] or len(s["dataset"])>50):fail("Conjunto de dados inválido.")
        params=s.get("parameters",{})
        if type(s.get("report_id")) is not int or s["report_id"]<1 or not isinstance(params,dict) or len(params)>30 or any(not isinstance(k,str) or len(k)>50 or (type(v) not in (str,int,float,bool,type(None)) and not (isinstance(v,dict) and set(v)=={"parameter"} and isinstance(v["parameter"],str) and len(v["parameter"])<=50)) for k,v in params.items()):
            fail("Fonte SQL ou parâmetros inválidos.")
    def read(self,context,s):
        child=resolve_report(context.report,s)
        # Runtime recipient restrictions have precedence over per-source defaults.
        defaults={}
        for key,value in s.get("parameters",{}).items():
            if isinstance(value,dict):
                name=value["parameter"]
                if name not in context.parameters:fail("Parâmetro de origem não informado: "+name)
                value=context.parameters[name]
            defaults[key]=value
        vals={**defaults,**{k:v for k,v in context.parameters.items() if k in child.parameter_schema}}
        from .native import datasets,read
        if datasets(child):return read(context,child,s.get("dataset","rows"),vals)
        if child.connection_id not in context.sessions:
            from operations.report_engine import connect
            context.sessions[child.connection_id]=context.stack.enter_context(connect(child.connection))
        cols,rows=run_query(child,vals,session=context.sessions[child.connection_id],typed=True)
        return Dataset(cols,rows)

SOURCES.register("inline",InlineSource())
SOURCES.register("goals",GoalsSource())
SOURCES.register("report",ReportSource())
