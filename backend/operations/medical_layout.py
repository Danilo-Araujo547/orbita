"""Versioned medical PDF layout. No database or network access."""
import io,json,math
from pathlib import Path
from collections import defaultdict
from datetime import datetime,timedelta
from decimal import Decimal,ROUND_HALF_UP
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor,white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader

def render_medical_pdf(data, asset_root):
    B=Path(asset_root);D=data;L=json.loads((B/'layout.json').read_text())
    if 'SCVMedicalRegular' not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont('SCVMedicalRegular',str(B/'arial.ttf')))
        pdfmetrics.registerFont(TTFont('SCVMedicalBold',str(B/'arialbd.ttf')))
    now=datetime.fromisoformat(D['clock'][0]['DB_TIMESTAMP'])
    freshness=D['freshness']
    source_dates=[freshness['exames'][0]['ULTIMA_DATA'],freshness['atendimentos'][0]['ULTIMA_DATA'],freshness['internacao'][0]['ULTIMA_ALTA'],freshness['parecer'][0]['ULTIMA_DATA']]
    until=min(datetime.fromisoformat(v).date() for v in source_dates).strftime('%d/%m/%Y')
    months=[((now.year*12+now.month-1-i)//12, (now.year*12+now.month-1-i)%12+1) for i in range(12,-1,-1)]
    previous_year=now.year-1;current_year=now.year
    names=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];labels=[f'{names[m-1]}/{str(y)[2:]}' for y,m in months]
    days8=[(now.date()-timedelta(days=i)).isoformat() for i in range(8,0,-1)];days10=[(now.date()-timedelta(days=i)).isoformat() for i in range(10,0,-1)]
    W=1120;navy=HexColor('#173b55');ink=HexColor('#1e3446');muted=HexColor('#6c8190');rule=HexColor('#dce6ed');pale=HexColor('#f3f7fa');blue=HexColor('#2c6da7');orange=HexColor('#c18a49');gray=HexColor('#8d9aa5');green=HexColor('#27977b');red=HexColor('#c7646c')
    greenbg=HexColor('#e5f3eb');redbg=HexColor('#f9e7e8');greenfg=HexColor('#286a4e');redfg=HexColor('#a23c45')
    out=io.BytesIO();c=canvas.Canvas(out,pageCompression=1);c.setTitle('Indicadores médicos - Santa Casa Votuporanga');c.setAuthor('SCV Messenger');c.setSubject('Dados atualizados até '+until)
    page=0;H=0
    
    def txt(x,y,s,size=10,color=ink,bold=False,align='left'):
     c.setFont('SCVMedicalBold' if bold else 'SCVMedicalRegular',size);c.setFillColor(color);{'left':c.drawString,'center':c.drawCentredString,'right':c.drawRightString}[align](x,y,str(s))
    def rect(x,y,w,h,color):c.setFillColor(color);c.rect(x,y,w,h,fill=1,stroke=0)
    def line(x,y,xx,yy,color=rule,width=.6):c.setStrokeColor(color);c.setLineWidth(width);c.line(x,y,xx,yy)
    def start(title,height):
     nonlocal page,H;H=height;page+=1;c.setPageSize((W,H))
     c.drawImage(ImageReader(str(B/'logo.png')),36,H-55,width=28,height=28,preserveAspectRatio=True,anchor='c',mask='auto')
     txt(75,H-35,'SANTA CASA',10,navy,True);txt(75,H-49,'Votuporanga',9,muted)
     txt(W-36,H-37,'Indicadores médicos',11,navy,True,align='right');txt(W-36,H-52,'Dados atualizados até '+until,9,muted,align='right')
     line(36,H-68,W-36,H-68)
     txt(36,H-104,title,22,navy,True)
    def end():
     line(36,31,W-36,31);txt(W-36,15,str(page).zfill(2),8,muted,align='right');c.showPage()
    def rnd(v,n=2):return float(Decimal(str(v)).quantize(Decimal(10)**-n,rounding=ROUND_HALF_UP))
    def fmt(v,n=2):return f'{v:,.{n}f}'.replace(',','X').replace('.',',').replace('X','.')
    def key(r):return int(r['ANO']),int(r['MES'])
    def dl(s):d=datetime.fromisoformat(s);return f'{d.day:02d}/{d.month:02d}'
    def mean(p):return rnd(p[0]/p[1]) if p[1] else None
    s=defaultdict(lambda:[0.,0]);sus=defaultdict(lambda:[0.,0])
    for r in D['stays']:
     y,m=key(r);n=int(r['QUANTIDADE']);v=float(r['DIAS'] or 0);ins=r['TIPO_CONVENIO'];sp=r['DS_ESPECIALID']
     for k in [(y,m,ins),(y,0,ins)]:s[k][0]+=v;s[k][1]+=n
     if ins=='SUS':
      for k in [(sp,y,m),(sp,y,0)]:sus[k][0]+=v;sus[k][1]+=n
    periods=[(previous_year,0),(current_year,0)]+months;periodlabels=[str(previous_year),str(current_year)]+labels
    vals=[[mean(s[(y,m,ins)]) for y,m in periods] for ins in ['SUS','CONVENIO','PARTICULAR']]
    # Bookends taken from the supplied PowerPoint, preserving the original artwork.
    def bookend(first=False):
     nonlocal page,H
     page+=1;H=W*9/16;c.setPageSize((W,H))
     c.drawImage(ImageReader(str(B/('first-background.jpg' if first else 'last-background.jpg'))),0,0,width=W,height=H)
     if first:
      generated=datetime.fromisoformat(D['generated_at'])
      label='Indicadores Médicos: '+generated.strftime('%d/%m/%Y %H:%M:%S')
      xx=W*(694582/12192000);fontsize=26
      available=W*(8341873/12192000)-xx-24
      while pdfmetrics.stringWidth(label,'SCVMedicalBold',fontsize)>available:fontsize-=.2
      txt(xx,H*.43,label,fontsize,white,True)
     c.showPage()
    
    bookend(True)
    
    # 1. Line chart: visible scale, light guides, annual grouping, direct values.
    start('Tempo médio de permanência',560)
    for j,(name,color) in enumerate([('SUS',blue),('Convênio',orange),('Particular',gray)]):
     x=38+j*135;line(x,H-133,x+21,H-133,color,2.4);txt(x+29,H-137,name,10,muted)
    x0=65;x1=W-54;y0=100;y1=H-180;ch=y1-y0;step=(x1-x0)/14;maximum=max(1,math.ceil(max([0]+[v for row in vals for v in row if v is not None])+.4))
    rect(x0-20,y0,step*1.5+40,ch+18,pale)
    for tick in range(maximum+1):
     y=y0+tick/maximum*ch;line(x0-15,y,x1+15,y,rule,.45);txt(40,y-3,str(tick),9,muted,align='right')
    for j,(values,color) in enumerate(zip(vals,[blue,orange,gray])):
     prev=None
     for i,v in enumerate(values):
      if v is None:prev=None;continue
      x=x0+i*step;y=y0+v/maximum*ch
      if prev and i!=2:line(*prev,x,y,color,1.8)
      c.setFillColor(white);c.setStrokeColor(color);c.setLineWidth(1.5);c.circle(x,y,3,fill=1,stroke=1)
      txt(x,y+11,fmt(v),9.5,color,True,'center');prev=(x,y)
    for i,label in enumerate(periodlabels):txt(x0+i*step,y0-20,label,9,muted,align='center')
    txt(x0+step/2,60,'Anual',9,muted,align='center');txt(x0+step*8,60,'Mensal',9,muted,align='center');end()
    # Table helpers: air between values, restrained heat colors, no heavy cell borders.
    def table_header(x,y,widths,labels,height=26,size=9):
     rect(x,y-height,sum(widths),height,navy)
     for j,label in enumerate(labels):txt(x+sum(widths[:j])+widths[j]/2,y-height/2-size*.32,label,size,white,True,'center')
    def table_rows(x,y,widths,rows,rowheight=19,size=9,styles=None):
     for i,row in enumerate(rows):
      yy=y-(i+1)*rowheight;rect(x,yy,sum(widths),rowheight,white if i%2 else pale)
      for j,value in enumerate(row):
       xx=x+sum(widths[:j]);fg=ink;bg=None
       if styles and j: bg,fg=styles(i,j)
       if bg:rect(xx+1,yy+1,widths[j]-2,rowheight-2,bg)
       if j==0:txt(xx+9,yy+rowheight/2-size*.32,value,size,ink)
       else:txt(xx+widths[j]/2,yy+rowheight/2-size*.32,value,size,fg or ink,False,'center')
      line(x,yy,x+sum(widths),yy,white,.4)
    def rulecolor(id,sp,v):
     if v is None:return None,None
     for r in L['TBRELATORIO_CORES']:
      if r['ID_RELATORIO']==id and (not r.get('CRITERIO') or r['CRITERIO']==sp) and float(r['PERCENTUAL_INICIAL'])<=v<=float(r['PERCENTUAL_FINAL']):
       return (greenbg,greenfg) if float(r['PERCENTUAL_INICIAL'])==0 else (redbg,redfg)
     return None,None
    # 2. Same specialties and thresholds, significantly larger spacing.
    sp=[]
    for r in L['TBRELATORIO_CORES']:
     if r['ID_RELATORIO']==63 and r['CRITERIO'] not in sp:sp.append(r['CRITERIO'])
    start('Permanência por especialidade · SUS',540)
    x=36;first=234;cw=(W-72-first)/15;widths=[first]+[cw]*15
    annual=[(previous_year,0),(current_year,0)];matrix=[[mean(sus[(s,*k)]) for k in annual+months] for s in sp]
    rows=[[s]+[fmt(v) if v is not None else '-' for v in vv] for s,vv in zip(sp,matrix)]
    txt(x+first+cw, H-136,'Anual',9,muted,align='center');txt(x+first+2*cw+13*cw/2,H-136,'Mensal',9,muted,align='center')
    table_header(x,H-147,widths,['Especialidade','2025','2026']+labels,height=27,size=8.4)
    table_rows(x,H-174,widths,rows,20,8.9,lambda i,j:rulecolor(63,sp[i],matrix[i][j-1]))
    end()
    ex={key(r):float(r['QUANTIDADE']) for r in D['exams']};at={key(r):float(r['QUANTIDADE']) for r in D['attendances']}
    for y in (previous_year,current_year):
     ex[(y,0)]=sum(v for (yy,m),v in list(ex.items()) if yy==y and m);at[(y,0)]=sum(v for (yy,m),v in list(at.items()) if yy==y and m)
    exd={r['DATA'][:10]:float(r['QUANTIDADE']) for r in D['exams_days']};atd={r['DATA'][:10]:float(r['QUANTIDADE']) for r in D['attendances_days']}
    counts=[(ex.get(k,0),at.get(k,0)) for k in periods]+[(exd.get(k,0),atd.get(k,0)) for k in days8]
    ratios=[rnd(a/b) if b else None for a,b in counts]
    # 3. Actual bars and one clear target line; keep annual, monthly and daily values.
    start('Exames por atendimento',520)
    for j,(name,color) in enumerate([('Dentro da meta',green),('Acima da meta',red)]):
     x=36+j*160;rect(x,H-139,9,9,color);txt(x+17,H-139,name,10,muted)
    x0=65;x1=W-48;y0=102;y1=H-176;ch=y1-y0;step=(x1-x0)/len(ratios);maximum=math.ceil(max([2.5]+[v for v in ratios if v is not None])+.25)
    for t in range(maximum+1):
     y=y0+t/maximum*ch;line(x0-12,y,x1,y,rule,.45);txt(40,y-3,str(t),9,muted,align='right')
    for i,v in enumerate(ratios):
     if v is None:continue
     x=x0+i*step+step*.19;w=step*.57;bh=v/maximum*ch;color=green if v<=2.5 else red
     c.setFillColor(color);c.roundRect(x,y0,w,bh,2,fill=1,stroke=0)
     txt(x+w/2,y0+bh+9,fmt(v),8.7,ink,True,'center')
    y=y0+2.5/maximum*ch;c.setDash(4,3);line(x0-12,y,x1,y,navy,.8);c.setDash();txt(x0,y+7,'Meta 2,50',9,navy,True)
    for i,label in enumerate(periodlabels+[dl(s) for s in days8]):txt(x0+(i+.475)*step,y0-19,label,8,muted,align='center')
    groups=[(0,2,'Anual'),(2,15,'Mensal'),(15,23,'Diário')]
    for a,b,label in groups:
     xx=x0+a*step;xx2=x0+b*step;line(xx+4,66,xx2-6,66,rule,.8);txt((xx+xx2)/2,50,label,9,muted,align='center')
    end()
    # 4. Totals as period rows, with daily section alongside, preserving every source total.
    start('Exames e atendimentos',610)
    leftx=36;leftw=[190,185,185];rightx=636;rightw=[130,159,159];top=H-155
    textleft='Anual e mensal';txt(leftx,top+17,textleft,11,navy,True);txt(rightx,top+17,'Diário',11,navy,True)
    table_header(leftx,top,leftw,['Período','Exames','Atendimentos'],28,10)
    rows=[[lab,fmt(ex.get(k,0),0),fmt(at.get(k,0),0)] for k,lab in zip(periods,periodlabels)]
    table_rows(leftx,top-28,leftw,rows,25,10)
    table_header(rightx,top,rightw,['Dia','Exames','Atendimentos'],28,10)
    rows=[[dl(k),fmt(exd.get(k,0),0),fmt(atd.get(k,0),0)] for k in days8];table_rows(rightx,top-28,rightw,rows,25,10);end()
    # 5. Exact urgency response-time metric from legacy formula, readable monthly/daily sections.
    opm={(r['DS_ESPECIALID'],*key(r)):(r['DIAS'],r['QUANTIDADE']) for r in D['opinions_months']};opd={(r['DS_ESPECIALID'],r['DATA'][:10]):(r['DIAS'],r['QUANTIDADE']) for r in D['opinions_days']}
    order=['NEUROLOGIA','CIRURGIA GERAL','CARDIOLOGIA','CLINICA GERAL','GINECOLOGIA/OBSTETRICIA','CIRURGIA PEDIATRICA','NEFROLOGIA','ORTOPEDIA/TRAUMATOLOGIA','GINECOLOGIA','UROLOGIA','CIRURGIA CARDIOVASCULAR','GRUPO DE CURATIVOS','CIRURGIA VASCULAR','CIRURGIA TORAXICA']
    def mt(p):return rnd(float(p[0])/int(p[1]),5) if p[0] not in (None, '') and int(p[1]) else None
    def tf(v):s=int(v*86400);return f'{s//3600:02d}:{s//60%60:02d}:{s%60:02d}'
    start('Tempo de resposta · Pareceres de urgência',820)
    x=36;first=234
    for section,top,fields,source in [('Mensal',H-157,months,opm),('Diário',H-476,days10,opd)]:
     txt(x,top+17,section,11,navy,True)
     widths=[first]+[(W-72-first)/len(fields)]*len(fields);vv=[]
     for s in order:vv.append([mt(source.get((s,*k) if isinstance(k,tuple) else (s,k),(None,0))) for k in fields])
     rows=[[s]+[tf(v) if v is not None else '-' for v in vs] for s,vs in zip(order,vv)]
     table_header(x,top,widths,['Especialidade']+(labels if section=='Mensal' else [dl(s) for s in fields]),26,8.5)
     table_rows(x,top-26,widths,rows,18.2,8.8,lambda i,j:rulecolor(68,order[i],vv[i][j-1]))
    end();bookend(False);c.save();return out.getvalue()
