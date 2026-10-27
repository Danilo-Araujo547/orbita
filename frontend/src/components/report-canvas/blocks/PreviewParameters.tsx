import { useState } from "react";
import { collectTestParameters } from "../parameters";
import type { TestParameter } from "../parameters";

export default function PreviewParameters({fields, values, onSubmit}: {
  fields: TestParameter[]; values: Record<string,string>; onSubmit: (parameters: Record<string,unknown>) => void;
}) {
  const [draft, setDraft] = useState(values);
  const [error, setError] = useState("");
  return <form className="cv-preview-parameters" onSubmit={event => {
    event.preventDefault(); event.stopPropagation();
    try { const parameters = collectTestParameters(fields, draft); setError(""); onSubmit(parameters); }
    catch (err) { setError((err as Error).message); }
  }}>
    {fields.map(field => <label key={field.name}>{field.label}{field.required !== false && field.default == null ? " *" : ""}
      {field.options ? <select value={draft[field.name] || ""} onChange={e => setDraft({...draft, [field.name]: e.target.value})}><option value="">Selecione</option>{field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        : <input value={draft[field.name] || ""} placeholder={field.type === "date" ? "DD/MM/AAAA" : undefined} onChange={e => setDraft({...draft, [field.name]: e.target.value})} />}
    </label>)}
    {error && <p role="alert">{error}</p>}
    <button type="submit" className="cv-btn-compact">Tentar de novo</button>
    <small>Parâmetros só desta prévia · sem salvar</small>
  </form>;
}
