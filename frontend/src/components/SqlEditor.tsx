import {useMemo,useRef} from "react";
import type {TextareaHTMLAttributes} from "react";
import {queryParameterRanges} from "./reportParameters";
import "./sql-editor.css";
export default function SqlEditor({value="",className="",onScroll,...props}:TextareaHTMLAttributes<HTMLTextAreaElement>){
 const layer=useRef<HTMLPreElement>(null);
 const sql=String(value);
 const highlighted=useMemo(()=>{
  const nodes=[];let cursor=0;
  for(const item of queryParameterRanges(sql)){
   nodes.push(sql.slice(cursor,item.start));
   nodes.push(<span className="sql-parameter" key={item.start}>{sql.slice(item.start,item.end)}</span>);
   cursor=item.end;
  }
  nodes.push(sql.slice(cursor));return nodes;
 },[sql]);
 return <div className="sql-editor">
  <pre ref={layer} className="sql-editor-colors" aria-hidden="true">{highlighted}{"\n"}</pre>
  <textarea {...props} value={value} spellCheck={false} autoCorrect="off" autoCapitalize="off" wrap="off" className={`sql-editor-input ${className}`} onScroll={event=>{
   if(layer.current){layer.current.scrollTop=event.currentTarget.scrollTop;layer.current.scrollLeft=event.currentTarget.scrollLeft;}
   onScroll?.(event);
  }}/>
 </div>;
}
