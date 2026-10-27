import json
from pathlib import Path
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone
from core.models import Audit
from operations.models import ReportDefinition,ReportExecution
from operations.report_canvas.native import datasets
from operations.report_canvas.ports import make_layout,VERSION

class Command(BaseCommand):
 help="Porta definições homologadas para rascunhos editáveis, sem ativar envios ou geradores."
 def add_arguments(self,p):
  p.add_argument("--apply",action="store_true")
  p.add_argument("--backup",default="/tmp/canvas-before-port.json")
 def handle(self,*args,**opts):
  reports=list(ReportDefinition.objects.filter(catalog_kind="report",reviewed=True).select_related("unit","connection").order_by("pk"))
  before=[{"id":r.pk,"version":r.version,"canvas_layout":r.canvas_layout,"canvas_enabled":r.canvas_enabled,"legacy":r.legacy} for r in reports]
  if opts["apply"]:Path(opts["backup"]).write_text(json.dumps(before,ensure_ascii=False,default=str))
  for candidate in reports:
   with transaction.atomic():
    r=ReportDefinition.objects.select_for_update(of=("self",)).select_related("unit","connection").get(pk=candidate.pk)
    if not datasets(r) and r.source!="sql":
     self.stdout.write(f"PENDENTE {r.pk} {r.name}: fonte externa ou gerador não portado");continue
    if r.canvas_enabled or (r.canvas_layout and not r.legacy.get("canvas_port")):
     self.stdout.write(f"PRESERVADO {r.pk} {r.name}: layout personalizado");continue
    if r.legacy.get("canvas_port",{}).get("version")==VERSION:
     self.stdout.write(f"ATUAL {r.pk} {r.name}");continue
    if ReportExecution.objects.filter(report=r,state__in=["pending","running"]).exists():
     self.stdout.write(f"ADIADO {r.pk} {r.name}: execução em andamento");continue
    if opts["apply"]:
     r.canvas_layout=make_layout(r)
     r.legacy={**r.legacy,"canvas_port":{"version":VERSION,"at":timezone.now().isoformat(),"status":"draft","previous_version":r.version}}
     r.version+=1;r.save(update_fields=["canvas_layout","legacy","version"])
     Audit.objects.create(unit=r.unit,action="report.canvas_ported",object_id=str(r.pk),details={"version":r.version,"port_version":VERSION,"enabled":False})
    self.stdout.write(f"{"PORTADO" if opts["apply"] else "PREVISTO"} {r.pk} {r.unit.slug} {r.name}")
