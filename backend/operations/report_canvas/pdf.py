import io
import math
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.platypus import Paragraph, LongTable, TableStyle
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF
from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.charts.linecharts import HorizontalLineChart
from reportlab.graphics.charts.piecharts import Pie
from .registry import EXPORTERS, Registry
from .schema import fail
from .formatting import display

RENDERERS=Registry()
PALETTE=["#075b94","#14b4cb","#71bfa6","#7289ba","#af76b5","#db9d49"]


def style(block,size=None):
    return ParagraphStyle("Canvas",fontName="Helvetica",fontSize=size or block["options"].get("font_size",14)*0.75,leading=(size or block["options"].get("font_size",14)*0.75)*1.25,textColor=colors.HexColor(block["options"].get("color","#075b94")),spaceAfter=0)


def text(c,b,w,h):
    value=(b.get("title","")+"\n"+b.get("text","")).strip()
    paragraph=Paragraph(escape(value).replace("\n","<br/>"),style(b))
    _,height=paragraph.wrap(w,h)
    if height>h+1:fail("Aumente a altura do bloco de texto: "+b.get("title",b["id"]))
    paragraph.drawOn(c,0,h-height)


def draw_paragraph(c,b,text,w,top,size=10):
    p=Paragraph(escape(text),style(b,size));_,ph=p.wrap(w,10000);p.drawOn(c,0,top-ph)


def kpi(c,b,w,h):
    if b.get("title"):draw_paragraph(c,b,b["title"],w,h)
    value=b["value"]
    label="Sem dados" if value is None else f"{value:,.{b['options'].get('precision',0)}f}".replace(",","_").replace(".",",").replace("_",".")
    c.setFillColor(colors.HexColor(b["options"].get("color","#075b94")));c.setFont("Helvetica-Bold",b["options"].get("font_size",40)*.75);c.drawString(0,max(4,h/2-10),label)


def image(c,b,w,h):
    a=b["image"];c.drawImage(ImageReader(io.BytesIO(bytes(a.data))),0,0,width=w,height=h,preserveAspectRatio=True,anchor="c",mask="auto")


def line_chart(c,b,w,h):
    """Draw sparse series as segments and points; missing values never become zeros."""
    cols=b["columns"];rows=b["rows"]
    numbers=[v for r in rows for v in r[1:] if v is not None]
    if not numbers:draw_paragraph(c,b,"Sem dados",w,h);return
    draw_paragraph(c,b,b.get("title",""),w,h,10)
    left,bottom=36,38;right,top=w-12,h-30
    low=min(numbers);high=max(numbers)
    if high==low:low-=1;high+=1
    pad=(high-low)*.08;low-=pad;high+=pad
    for i in range(5):
        value=low+(high-low)*i/4;y=bottom+(top-bottom)*i/4
        c.setStrokeColor(colors.HexColor("#dce5ed"));c.setLineWidth(.4);c.line(left,y,right,y)
        c.setFillColor(colors.HexColor("#526980"));c.setFont("Helvetica",7);c.drawRightString(left-4,y-2,f"{value:.2f}")
    step=(right-left)/max(1,len(rows)-1);stride=max(1,math.ceil(len(rows)/12))
    for i,r in enumerate(rows):
        if i%stride==0:
            c.setFillColor(colors.HexColor("#526980"));c.setFont("Helvetica",6);c.drawCentredString(left+i*step,bottom-12,str(r[0]))
    for series,name in enumerate(cols[1:]):
        tone=colors.HexColor(b["options"].get("color",PALETTE[0]) if series==0 else PALETTE[series%len(PALETTE)])
        c.setStrokeColor(tone);c.setFillColor(tone);c.setLineWidth(1.2);previous=None
        for i,r in enumerate(rows):
            value=r[series+1]
            if value is None:previous=None;continue
            x=left+i*step;y=bottom+(value-low)/(high-low)*(top-bottom)
            if previous:c.line(*previous,x,y)
            c.circle(x,y,1.8,fill=1,stroke=0);previous=(x,y)
        c.setFont("Helvetica",7);c.drawString(left+series*(max(1,(right-left)/len(cols))),8,str(name))


def chart(c,b,w,h):
    if not b["rows"] or all(all(v is None for v in r[1:]) for r in b["rows"]):
        draw_paragraph(c,b,"Sem dados",w,h);return
    if w<90 or h<70:fail("Aumente o tamanho do gráfico: "+b.get("title",b["id"]))
    if b["type"]=="line":line_chart(c,b,w,h);return
    title=Paragraph(escape(b.get("title","")),style(b,10));_,th=title.wrap(w,20);title.drawOn(c,0,h-th)
    d=Drawing(w,h-20)
    if b["type"]=="pie":
        g=Pie();g.width=w*.55;g.height=min(w*.55,max(30,h-80));g.x=(w-g.width)/2;g.y=20;g.data=[r[1] or 0 for r in b["rows"]];g.labels=[r[0] for r in b["rows"]]
        if not sum(g.data):draw_paragraph(c,b,"Sem dados",w,h-20);return
        g.sideLabels=True;g.simpleLabels=False;g.slices.fontSize=7
        for i in range(len(g.data)):g.slices[i].fillColor=colors.HexColor(PALETTE[i%len(PALETTE)])
    else:
        g=VerticalBarChart() if b["type"]=="bar" else HorizontalLineChart()
        legend_height=0
        if len(b["columns"])>2:
            names=[]
            for i,name in enumerate(b["columns"][1:]):
                tone=b["options"].get("color",PALETTE[0]) if i==0 else PALETTE[i%len(PALETTE)]
                names.append('<font color="'+tone+'">'+escape(str(name))+'</font>')
            legend=Paragraph(" &nbsp;|&nbsp; ".join(names),style(b,7))
            _,legend_height=legend.wrap(w,1000)
            if h<80+legend_height:fail("Aumente a altura do gráfico para exibir a legenda.")
            legend.drawOn(c,0,0)
        g.x=35;g.y=30+legend_height;g.width=max(30,w-45);g.height=max(25,h-75-legend_height)
        g.data=[[r[i] for r in b["rows"]] for i in range(1,len(b["columns"]))]
        stride=max(1,math.ceil(len(b["rows"])/12));g.categoryAxis.categoryNames=[r[0] if i%stride==0 else "" for i,r in enumerate(b["rows"])]
        g.categoryAxis.labels.fontSize=6;g.categoryAxis.labels.angle=25;g.valueAxis.labels.fontSize=7
        if b["type"]=="bar":g.valueAxis.valueMin=min([0,*[v for row in b["rows"] for v in row[1:] if v is not None]])
        for i in range(len(g.data)):
            if b["type"]=="bar":g.bars[i].fillColor=colors.HexColor(b["options"].get("color",PALETTE[0]) if i==0 else PALETTE[i%len(PALETTE)])
            else:g.lines[i].strokeColor=colors.HexColor(b["options"].get("color",PALETTE[0]) if i==0 else PALETTE[i%len(PALETTE)])
    d.add(g);renderPDF.draw(d,c,0,0)


def table_parts(b,w,h):
    cols=b["columns"];rows=b["rows"]
    if not cols:return []
    data=[[Paragraph(escape(display(v)),style(b,b["options"].get("font_size",10)*.75)) for v in row] for row in [cols,*rows]]
    weights=b["options"].get("column_widths") or [1]*len(cols)
    t=LongTable(data,colWidths=[w*v/sum(weights) for v in weights],repeatRows=1,hAlign="LEFT")
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#e5eef5")),("VALIGN",(0,0),(-1,-1),"TOP"),("LINEBELOW",(0,0),(-1,-1),0.25,colors.HexColor("#dce5ed")),("LEFTPADDING",(0,0),(-1,-1),3),("RIGHTPADDING",(0,0),(-1,-1),3)]))
    available=h-(18 if b.get("title") else 0)
    parts=[]
    while True:
        _,height=t.wrap(w,available)
        if height<=available:parts.append(t);break
        pieces=t.split(w,available)
        if len(pieces)<2:fail("Uma linha não cabe no bloco; aumente a altura da tabela: "+b.get("title",b["id"]))
        parts.append(pieces[0]);t=pieces[1]
        if len(parts)>200:fail("Tabela excede 200 páginas.")
    return parts


class PDFExporter:
    def render(self,document):
        w=document["page"]["width"]*.75;h=document["page"]["height"]*.75
        out=io.BytesIO();c=canvas.Canvas(out,pagesize=(w,h),pageCompression=1);c.setTitle(document["name"])
        total_pages=0
        for page in document["pages"]:
            tables={b["id"]:table_parts(b,b["width"]*.75,b["height"]*.75) for b in page["blocks"] if b["type"]=="table"}
            continuation=max([1,*[len(parts) for parts in tables.values()]])
            for index in range(continuation):
                total_pages+=1
                if total_pages>200:fail("Relatório excede 200 páginas.")
                c.setFillColor(colors.HexColor(document["page"]["background"]));c.rect(0,0,w,h,fill=1,stroke=0)
                for b in page["blocks"]:
                    bw=b["width"]*.75;bh=b["height"]*.75
                    c.saveState();c.translate(b["x"]*.75,h-(b["y"]+b["height"])*.75)
                    clip=c.beginPath();clip.rect(0,0,bw,bh);c.clipPath(clip,stroke=0,fill=0)
                    if b["type"]=="table":
                        parts=tables[b["id"]]
                        if index<len(parts):
                            if b.get("title"):draw_paragraph(c,b,b["title"],bw,bh)
                            t=parts[index];_,height=t.wrap(bw,bh);t.drawOn(c,0,bh-(18 if b.get("title") else 0)-height)
                    else:RENDERERS[b["type"]](c,b,bw,bh)
                    c.restoreState()
                c.showPage()
        c.save();return out.getvalue()

RENDERERS.register("text",text)
RENDERERS.register("kpi",kpi)
RENDERERS.register("image",image)
for kind in ("bar","line","pie"):RENDERERS.register(kind,chart)
EXPORTERS.register("pdf",PDFExporter())
