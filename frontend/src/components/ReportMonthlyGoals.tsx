import { Plus, Trash2 } from "lucide-react";

type Goal = { year: number; month: number; value: number };
export default function ReportMonthlyGoals({ value, onChange }: { value: Goal[]; onChange: (value: Goal[]) => void }) {
  function update(index: number, patch: Partial<Goal>) {
    onChange(value.map((row, i) => i === index ? { ...row, ...patch } : row));
  }
  function add() {
    const last = [...value].sort((a, b) => a.year * 12 + a.month - b.year * 12 - b.month).at(-1);
    const date = last ? new Date(last.year, last.month, 1) : new Date();
    onChange([...value, { year: date.getFullYear(), month: date.getMonth() + 1, value: 0 }]);
  }
  return <section className="report-monthly-goals">
    <div className="report-monthly-goals-heading"><h3>Metas mensais</h3><button type="button" className="button" onClick={add}><Plus size={14} />Adicionar competência</button></div>
    <div className="report-monthly-goals-scroll"><table className="data-table"><thead><tr><th>Competência</th><th>Meta de vidas</th><th aria-label="Ações" /></tr></thead><tbody>
      {value.map((row, index) => <tr key={index}>
        <td><input aria-label={`Competência ${index + 1}`} type="month" required min="2000-01" max="2199-12" value={`${row.year}-${String(row.month).padStart(2, "0")}`} onChange={(e) => { const [year, month] = e.target.value.split("-").map(Number); update(index, { year, month }); }} /></td>
        <td><input aria-label={`Meta ${index + 1}`} type="number" required min={0} max={100000000} step={1} value={Number.isNaN(row.value) ? "" : row.value} onChange={(e) => update(index, { value: e.target.valueAsNumber })} /></td>
        <td><button type="button" className="button" aria-label={`Remover meta ${String(row.month).padStart(2, "0")}/${row.year}`} onClick={() => onChange(value.filter((_, i) => i !== index))}><Trash2 size={14} /></button></td>
      </tr>)}
    </tbody></table>{value.length === 0 && <p>Sem metas cadastradas.</p>}</div>
  </section>;
}
