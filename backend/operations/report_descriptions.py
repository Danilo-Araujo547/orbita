"""Read-only explanations from current definitions, separated from legacy evidence.

No SQL execution, credentials, or inferred snapshot schedules.
"""
import re
from operations.models import ReportDefinition, ReportSnapshotConfiguration, ReportAutomation

LOCAL = {
 "confirmed":"Lista confirmações registradas nos acompanhamentos.",
 "declined":"Lista recusas registradas nos acompanhamentos.",
 "no_response":"Lista acompanhamentos sem resposta no prazo.",
 "failures":"Lista falhas de envio registradas no sistema.",
 "contacts":"Lista contatos e resultados de atendimento.",
 "not_confirmed":"Lista acompanhamentos ainda não confirmados.",
 "not_sent":"Lista acompanhamentos sem mensagem enviada.",
 "combined":"Reúne informações operacionais de mensagens, respostas e acompanhamentos.",
}
ENGINES={"oracle":"Oracle","postgres":"PostgreSQL","firebird":"Firebird","sqlite":"SQLite","mysql":"MySQL"}
DAYS=["seg","ter","qua","qui","sex","sáb","dom"]

def index_for(unit_id):
 reports=list(ReportDefinition.objects.filter(unit_id=unit_id).select_related("connection"))
 configs=list(ReportSnapshotConfiguration.objects.filter(unit_id=unit_id).prefetch_related("consumers"))
 return {"by_code":{r.code:r for r in reports},"by_id":{r.pk:r for r in reports},"configs":configs,
 "automatic":set(ReportAutomation.objects.filter(unit_id=unit_id,enabled=True).values_list("report_id",flat=True))}

def tables(sql):
 # Evidence labels only; never parse literals/comments as source names.
 sql=re.sub(r"--[^\n]*|/\*.*?\*/|'(?:''|[^'])*'", " ",sql or "",flags=re.S)
 names=[]
 for name in re.findall(r"\b(?:from|join)\s+([A-Za-z_][\w$#]*(?:\s*\.\s*[A-Za-z_][\w$#]*)?)",sql,re.I):
  name=re.sub(r"\s+","",name)
  if name.upper()!="DUAL" and name not in names:names.append(name)
 return names[:8]

def connection(r):
 c=r.connection
 if not c or c.unit_id!=r.unit_id:return "Conexão ainda não definida na unidade."
 engine=ENGINES.get(c.engine,c.engine)
 return f"{engine} · {c.name}" + (f" · {c.database}" if c.database and c.database.casefold() not in c.name.casefold() else "")

def describe(report,index):
 legacy=report.legacy if isinstance(report.legacy,dict) else {}
 current=report.handler
 out={"summary":report.name,"origin":"","assembly":"","components":[],"routines":[],"snapshots":"Não identificado no mapeamento disponível.","pending":[]}
 parts=report.components if isinstance(report.components,list) else []
 # These native adapters do not consume their obsolete legacy component list.
 if current=="lives_indicators_v1":
  codes=["vidas-sansaude-production-oracle"]
 elif current=="exams_per_attendance_v1":
  codes=["exams-attendance-exams-source","exams-attendance-visits-source"]
 else:codes=[p.get("code") for p in parts if isinstance(p,dict) and p.get("code")]
 for src in (report.canvas_layout or {}).get("sources",[]):
  if src.get("type")=="report" and src.get("report_id")!=report.pk:
   child=index["by_id"].get(src.get("report_id"))
   if child and child.code not in codes:codes.append(child.code)
 for code in codes:
  child=index["by_code"].get(code)
  out["components"].append({"code":code,"name":child.name if child else "Componente não localizado nesta unidade"})
 if current=="app_operational_v1":
  c=report.app_connection
  out.update(origin=("SCV · "+c.name) if c and c.unit_id==report.unit_id else "Conexão do app pendente.",assembly="Consulta as informações operacionais da instância vinculada e organiza o resultado no Canvas.",snapshots="Sem Firebird ou importação de histórico legado; consulta dados do SCV no momento da geração.")
 elif current=="medical_indicators_v1":
  out.update(summary="Indicadores de permanência, exames por atendimento e tempo de resposta dos pareceres médicos.",origin=connection(report),assembly="Cinco consultas Oracle alimentam cálculos mensais e diários. O Canvas monta gráficos e tabelas com imagens de abertura e encerramento versionadas.",snapshots="Sem cache histórico Firebird ou coleta diária persistida; consultas Oracle de leitura na geração.")
 elif current=="exams_per_attendance_v1":
  out.update(summary="Quantidade e razão de exames por atendimento, no total e por prestador.",origin="Oracle de produção, pelas duas fontes auxiliares; meta preservada no cadastro SCV.",assembly="Cruza agregados de exames e atendimentos por período e prestador, calcula a razão e compara com a meta. O Canvas monta gráficos e tabelas.",snapshots="Sem tabela temporária Firebird; agregados consultados no Oracle durante a geração.")
 elif current=="lives_indicators_v1":
  out.update(summary="Beneficiários Sansaúde por tipo de contrato e comparação com metas mensais.",origin="Oracle prdvotu + histórico legado de produção importado no PostgreSQL + metas mensais do SCV.",assembly="Duas páginas no Canvas: posições anuais, 13 competências e 10 datas recentes; depois, total mensal versus meta.",snapshots="Preserva fotografias mensais e diárias legadas no PostgreSQL. Datas sem fotografia são reconstruídas no Oracle e identificadas; não equivalem a snapshots originais.")
 elif current=="bed_snapshots_v1":
  out.update(summary="Histórico diário da quantidade de leitos por unidade de internação.",origin="Fotografias armazenadas no PostgreSQL; a coleta atual consulta Oracle e o histórico legado foi importado.",assembly="Seleciona fotografias no período informado e exporta código, unidade, quantidade e data pelo Canvas.",snapshots="Depende de fotografias diárias persistidas. A consulta atual não reconstrói automaticamente posições passadas.")
 elif current=="stock_loans_v1":
  out.update(summary="Movimentações de empréstimos de estoque, por fornecedor e produto.",origin=connection(report),assembly="Consulta os movimentos no período e organiza itens e totais por fornecedor. A geração utiliza o Canvas.",snapshots="Consulta direta na geração; nenhuma coleta de snapshot vinculada ao cadastro.")
 elif current=="external_pdf_v1":
  out.update(origin="PDF pronto publicado na pasta autorizada do servidor SCV.",assembly="O sistema valida e carrega o PDF existente; não recompõe seus dados. O Canvas utiliza as páginas do documento publicado.",snapshots="Arquivo publicado; não é uma coleta de dados do banco.")
  if legacy.get("source_path"):out["routines"].append("Origem legada documentada: "+legacy["source_path"])
 elif report.source=="local" and current in LOCAL:
  out.update(summary=LOCAL[current],origin="Banco de dados do SCV, limitado à unidade e ao período selecionados.",assembly="Filtra casos, mensagens, respostas e interações locais e organiza as linhas para exportação"+(" pelo Canvas." if report.canvas_enabled else "."),snapshots="Consulta operacional atual; não usa fotografias do Firebird.")
 elif report.source=="sql":
  out["origin"]=connection(report)
  refs=tables(report.query_sql)
  out["assembly"]=("Consulta SQL cadastrada"+(": "+", ".join(refs) if refs else "")+". "+("O Canvas organiza o resultado no layout cadastrado." if report.canvas_enabled else "A definição de saída usa o formato "+report.output_format.upper()+"."))
  if not report.reviewed:out["pending"].append("Consulta cadastrada ainda não revisada; funcionamento não confirmado.")
 elif report.source=="composite":
  out["origin"]="Fontes dos componentes relacionados abaixo."
  out["assembly"]="Reúne os componentes na ordem cadastrada"+(" no Canvas." if report.canvas_enabled else "; montagem final ainda depende da validação da definição.")
 else:
  out["origin"]=legacy.get("source_path") or "Origem ainda não identificada."
  out["assembly"]="Definição legada preservada; gerador ou integração ainda não confirmado."
  if report.source=="external_file":out["assembly"]="O legado distribui um arquivo externo pronto; o gerador original ainda não foi recuperado."
 # Legacy routines are evidence, not a claim of current execution.
 proc=(legacy.get("record") or {}).get("PROCEDIMENTO","")
 if proc and proc not in {"<NULL>","NULL"} and not current and not re.search(r"\.(pdf|xlsx?|csv)$",proc,re.I):
  out["routines"].append("Rotina indicada no legado: "+proc+" (execução atual não confirmada).")
 if not current and report.source=="sql" and legacy.get("source_path"):
  out["routines"].append("Caminho legado: "+legacy["source_path"])
 for config in index["configs"]:
  consumers={c.pk for c in config.consumers.all() if c.unit_id==report.unit_id}
  if report.pk not in {config.source_report_id,config.output_report_id,*consumers}:continue
  days=", ".join(DAYS[d] for d in config.weekdays if type(d)is int and 0<=d<7)
  out["routines"].append(f"Coleta {config.name}: {config.collection_time:%H:%M:%S}, {days or 'dias não definidos'}, {config.environment}; {'ativa' if config.enabled else 'desativada'}.")
  child=index["by_id"].get(config.source_report_id)
  if child:
   out["routines"].append("Fonte da coleta: "+child.name+" ("+child.code+").")
   if current=="bed_snapshots_v1" and not any(p["code"]==child.code for p in out["components"]):
    out["components"].append({"code":child.code,"name":child.name+" · fonte da coleta"})
  out["snapshots"]+=" Coleta vinculada: "+config.code+"."
 if report.pk in index["automatic"]:out["routines"].append("Há programações de envio ativas; horários e destinatários constam em Programações.")
 for value in report.dependencies or []:
  if value and value not in out["pending"]:out["pending"].append(str(value))
 if report.unavailable_reason and report.unavailable_reason not in out["pending"] and report.unavailable_reason != "; ".join(out["pending"]):out["pending"].append(report.unavailable_reason)
 if not out["components"]:out["components_note"]="Nenhum componente vinculado na definição atual."
 if not out["routines"]:out["routines"]=["Nenhuma rotina vinculada identificada no cadastro."]
 return out


def as_text(value):
 """Seed the editor from mapped evidence without replacing a saved description."""
 parts=[value["summary"],"Origem: "+value["origin"],"Montagem: "+value["assembly"]]
 components="; ".join(p["name"]+" ("+p["code"]+")" for p in value["components"])
 parts.extend(["Componentes: "+(components or value.get("components_note","Nenhum vinculado.")),"Rotinas: "+" ".join(value["routines"]),"Snapshots: "+value["snapshots"]])
 if value["pending"]:parts.append("Pendências: "+"; ".join(value["pending"]))
 return "\n\n".join(parts)
