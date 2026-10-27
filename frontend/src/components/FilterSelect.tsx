import type {ReactNode} from "react";
import Select from "./Select";
export default function FilterSelect({value,onChange,label,children}:{value:string;label:string;children:ReactNode;onChange:(event:{target:{value:string}})=>void}){
 return <Select className="filter-select" value={value} onChange={onChange} label={label}>{children}</Select>;
}
