import {useEffect,useState} from "react";
import {ArrowLeft} from "lucide-react";
import {query,request} from "../api";
import ReportCanvas from "./ReportCanvas";
export default function ReportCanvasPage({id,unit,admin}:{id:number;unit:string;admin:boolean}) {
 const [report,setReport]=useState<any>(null),[error,setError]=useState("");
 const back=()=>{window.history.pushState({},"",`/relatorios?unit=${encodeURIComponent(unit)}`);window.dispatchEvent(new PopStateEvent("popstate"));};
 useEffect(()=>{let alive=true;setReport(null);setError("");if(admin)request(query(`reports/${id}`,{unit})).then(r=>{if(alive)setReport(r);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[id,unit,admin]);
 useEffect(()=>{if(!report)return;const previous=document.title;document.title=`${report.name} · Canvas · SCV Messenger`;return()=>{document.title=previous;};},[report]);
 if(!admin || error)return <div className="rc-route-state"><button type="button" className="button" onClick={back}><ArrowLeft size={16}/>Voltar</button><p role="alert">{error || "Acesso administrativo necessário."}</p></div>;
 if(!report)return <div className="rc-route-state" role="status">Carregando editor…</div>;
 return <ReportCanvas key={`${unit}:${id}`} unit={unit} report={report} onClose={back}/>;
}
