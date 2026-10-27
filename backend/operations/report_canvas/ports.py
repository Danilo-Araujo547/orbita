"""Repeatable draft layout ports. Never activates reports, transport or schedules."""
import hashlib,io
from pathlib import Path
from .schema import validate_layout
from .native import datasets

VERSION=1

def block(id,type,x,y,w,h,title="",source=None,**options):
 b={"id":id,"type":type,"x":x,"y":y,"width":w,"height":h,"title":title,"options":{"font_size":14,"color":"#17638f",**options}}
 if source:b["source_id"]=source
 return b

def text(id,text,x,y,w,h,size=16,source=None):
 b=block(id,"text",x,y,w,h,source=source,font_size=size);b["text"]=text;return b

def layout(width=1123,height=794):
 return {"schema_version":1,"page":{"width":width,"height":height,"columns":24,"background":"#ffffff"},"sources":[],"pages":[]}

def source(report,name="rows",id="dados"):
 return {"id":id,"type":"report","report_id":report.pk,"dataset":name}

def image_asset(report,path):
 from PIL import Image
 from operations.models import ReportCanvasAsset
 raw=Path(path).read_bytes();out=io.BytesIO()
 with Image.open(io.BytesIO(raw)) as im:
  im.thumbnail((1600,1600));im=im.convert("RGBA");w,h=im.size;im.save(out,format="PNG")
 raw=out.getvalue();digest=hashlib.sha256(raw).hexdigest()
 asset,_=ReportCanvasAsset.objects.get_or_create(report=report,unit=report.unit,sha256=digest,defaults={"filename":Path(path).stem+".png","data":raw,"width":w,"height":h})
 return str(asset.pk)

def medical(report):
 from operations.medical_indicators import asset_root
 result=layout(1120,820)
 result["sources"]=[source(report,k,k) for k in datasets(report)]
 root=asset_root()
 def art(id,name,x,y,w,h):
  b=block(id,"image",x,y,w,h);b["asset_id"]=image_asset(report,root/name);return b
 result["pages"].append({"id":"cover","name":"Capa","blocks":[art("cover_art","first-background.jpg",0,95,1120,630),text("cover_title","Indicadores Médicos: {{metadata.gerado_em}}",64,430,950,60,26,"metadata")]})
 def page(id,title,content):
  result["pages"].append({"id":id,"name":title,"blocks":[art(id+"_logo","logo.png",36,24,40,40),text(id+"_title",title,90,24,730,45,23),text(id+"_date","Dados atualizados até {{metadata.data_atualizacao}}",36,76,1048,30,13,"metadata"),*content]})
 page("stays","Tempo médio de permanência",[block("stays_chart","line",36,130,1048,600,source="stays",x_field="Período",y_fields=["SUS","Convênio","Particular"],precision=2)])
 page("specialties","Permanência por especialidade · SUS",[block("specialties_table","table",36,130,1048,620,source="specialties",font_size=10,column_widths=[234]+[54]*15)])
 page("ratios","Exames por atendimento",[block("ratios_chart","bar",36,130,1048,600,source="ratios",x_field="Período",y_fields=["Exames por atendimento","Meta"],precision=2)])
 page("counts","Exames e atendimentos",[block("counts_table","table",36,130,640,620,"Anual e mensal","counts"),block("daily_table","table",700,130,384,620,"Diário","daily")])
 page("opinions","Tempo de resposta · Pareceres de urgência",[block("opinions_months_table","table",36,130,1048,320,"Mensal","opinions_months",font_size=9,column_widths=[234]+[63]*13),block("opinions_days_table","table",36,480,1048,320,"Diário","opinions_days",font_size=9,column_widths=[234]+[81]*10)])
 result["pages"].append({"id":"closing","name":"Encerramento","blocks":[art("closing_art","last-background.jpg",0,95,1120,630)]})
 return result

def tabular(report):
 result=layout();native=datasets(report)
 spec=source(report) if native else {"id":"dados","type":"report","report_id":report.pk}
 result["sources"]=[spec]
 columns=native.get("rows",[]) if native else []
 size=10 if len(columns)>7 else 12
 result["pages"]=[{"id":"p1","name":report.name[:100],"blocks":[text("title","{{report_name}}",32,28,1059,45,23),block("data","table",32,100,1059,650,source="dados",font_size=size)]}]
 if report.handler=="app_operational_v1" and len(columns)>9:
  result["page"].update(width=1600,height=1000)
  result["pages"][0]["blocks"][0].update(width=1536)
  result["pages"][0]["blocks"][1].update(width=1536,height=850)
  result["pages"][0]["blocks"][1]["options"]["font_size"]=9
 if report.handler=="bed_snapshots_v1":
  result["xlsx_mode"]="table"
  result["pages"][0]["blocks"][1]["options"]["column_widths"]=[100,360,120,140]
 if report.handler=="stock_loans_v1":
  result["pages"][0]["blocks"][0]["height"]=32
  result["pages"][0]["blocks"].insert(1,text("period","Período: {{WPA_DATA_INICIAL}} a {{WPA_DATA_FINAL}}",32,65,1059,25,13))
  result["sources"].append(source(report,"summary","resumo"))
  result["pages"].append({"id":"summary","name":"Totais por fornecedor","blocks":[text("summary_title","Totais por fornecedor",32,28,1059,45,23),block("summary_table","table",32,100,1059,550,source="resumo",font_size=12),text("stock_note","Estoque atual: posição na consulta. A soma das linhas não representa saldo consolidado; quantidades podem ter unidades diferentes.",32,680,1059,60,12)]})
 return result

def exams_attendance(report):
 result=layout(1600,1000)
 result["sources"]=[source(report,k,k) for k in datasets(report)]
 def heading(id,title):return [text(id+"_title",title,32,25,1536,48,26),text(id+"_date","Dados atualizados até {{metadata.atualizado_ate}}",32,78,1536,30,14,"metadata")]
 result["pages"]=[{"id":"overview","name":"Exames por atendimento","blocks":[*heading("overall","Exames por atendimento"),block("ratios","line",32,125,1536,285,source="chart",x_field="Período",y_fields=["Razão","Meta"],precision=2),block("totals","table",32,435,1536,520,source="overview",font_size=10,column_widths=[300,180,180,180,180])]},
 {"id":"providers","name":"Desempenho por prestador","blocks":[*heading("providers","Exames por atendimento · Prestadores"),block("providers_table","table",32,130,1536,830,source="providers",font_size=9,column_widths=[300]+[53.7]*23)]}]
 return result

def lives(report):
 result=layout(1600,1000)
 result["sources"]=[source(report,k,k) for k in datasets(report)]
 def header(id,title):return [text(id+"_title",title,32,24,1536,48,28),text(id+"_date","Dados atualizados até {{metadata.data_atualizacao}}",32,78,1536,28,14,"metadata")]
 result["pages"]=[{"id":"lives","name":"Vidas Sansaúde","blocks":[*header("lives","Vidas Sansaúde"),text("provenance","Datas sem fotografia reconstruídas no Oracle: {{metadata.dias_reconstruidos}}",32,109,1536,23,11,"metadata"),block("lives_chart","bar",32,135,1536,330,source="lives",x_field="Período",y_fields=["Empresarial","Individual","Adesão"]),block("lives_table","table",32,490,1536,480,source="lives",font_size=8,column_widths=[240,250,250,250,250])]},
 {"id":"goals","name":"Metas","blocks":[*header("goals","Vidas Sansaúde · Metas"),block("goal_chart","bar",32,135,1536,350,source="goals",x_field="Competência",y_fields=["Total","Meta"]),block("goal_table","table",32,515,1536,420,source="goals",font_size=12,column_widths=[400,400,400])]}]
 return result

def occupancy(report):
 result=layout(1600,1000)
 result["sources"]=[source(report,k,k) for k in datasets(report)]
 def art(id,filename):
  path=Path("/app/files/reports/indicadores-informativos/v1")/filename
  b=block(id,"image",0,30,1600,940);b["asset_id"]=image_asset(report,path);return b
 def header(id,title,number):
  return [text(id+"_title",title,32,22,1536,48,27),
   text(id+"_reference","Referência: {{metadata.referencia}} | Oracle produção | Consulta: {{metadata.consultado_em}}",32,77,1536,32,13,"metadata"),
   text(id+"_capacity","Capacidade histórica disponível até {{metadata.capacidade_ate}}",32,111,1536,28,12,"metadata"),
   text(id+"_page",str(number)+" / 10",1480,965,88,23,11)]
 def foot(id):
  return [text(id+"_gaps","Capacidade não carregada nas datas: {{metadata.lacunas}}",32,885,1536,36,11,"metadata"),
   text(id+"_note","— indica taxa indisponível por capacidade ausente/zero. Pacientes e eventos são reconstruídos por consulta Oracle; capacidade provém de fotografias legadas.",32,925,1536,35,11)]
 result["pages"].append({"id":"cover","name":"Capa","blocks":[art("cover_art","cabecalho.jpeg"),text("cover_date","Indicadores Informativos: {{metadata.referencia}}",90,810,1420,70,26,"metadata")]})
 for number,key,title in [(2,"general","Paciente-dia e taxa de ocupação · Geral"),(3,"sus","Paciente-dia e taxa de ocupação · SUS"),(4,"convenio","Paciente-dia e taxa de ocupação · Convênio")]:
  result["pages"].append({"id":key,"name":title,"blocks":[*header(key,title,number),
   block(key+"_chart","line",32,155,1536,230,"Ocupação (%)",key,x_field="Período",y_fields=["Ocupação (%)"],precision=0),
   block(key+"_table","table",32,400,1536,470,source=key,font_size=9,column_widths=[190,200,180,200,500]),*foot(key)]})
 result["pages"].append({"id":"sectors","name":"Ocupação por setor","blocks":[*header("sectors","Taxa de ocupação por setor",5),
  text("sectors_description","Treze competências, oito dias, posição de ontem e média de leitos. Percentuais preservam os arredondamentos intermediários.",32,155,1536,40,12),
  block("sectors_table","table",32,210,1536,640,source="sectors",font_size=8,column_widths=[210]+[58]*23),*foot("sectors")]})
 for number,key,title in [(6,"attendances","Média de atendimentos por tipo de entrada"),(7,"elective","Média de cirurgias · Eletivas"),(8,"urgent","Média de cirurgias · Urgência / Emergência"),(9,"surgeries","Média de cirurgias · Total")]:
  columns=datasets(report)[key]
  result["pages"].append({"id":key,"name":title,"blocks":[*header(key,title,number),
   block(key+"_chart","bar",32,155,1536,230,"Médias por dia",key,x_field="Período",y_fields=columns[1:6],precision=0 if key=="attendances" else 1),
   block(key+"_table","table",32,400,1536,470,source=key,font_size=9,column_widths=[200]+[190]*6),
   text(key+"_note","Cinco origens legadas; total = soma das séries arredondadas." if key=="attendances" else "Centro cirúrgico 1. Eletivas: E; urgência/emergência: U/M; total: todos os tipos. Totalização das médias arredondadas.",32,890,1536,50,12)]})
 result["pages"].append({"id":"closing","name":"Encerramento","blocks":[art("closing_art","rodape.jpeg")]})
 return result

def make_layout(report):
 result=occupancy(report) if report.handler=="occupancy_indicators_v1" else lives(report) if report.handler=="lives_indicators_v1" else exams_attendance(report) if report.handler=="exams_per_attendance_v1" else medical(report) if report.handler=="medical_indicators_v1" else tabular(report)
 result["export_format"]="xlsx" if report.output_format=="xlsx" else "pdf"
 return validate_layout(result)
