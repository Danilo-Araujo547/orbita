import { useEffect, useState } from "react";
import { AlertTriangle, Eye, Pause, Play } from "lucide-react";
import { query, request } from "../api";
import { dateTime } from "../format";
import type { Paginated } from "../types";
import InlineDialog from "./InlineDialog";

type Batch = {
  id: string; filename: string; layout_name: string; state: string; version: number;
  row_count: number; template_name: string; duplicates: number;
  errors: { line: number; code: string }[];
  control_status: {
    enabled: boolean; scheduled_for: string | null; enabled_count: number;
    disabled_count: number; message_counts: Record<string, number>; unit_paused: boolean;
  };
};
type CrossRecord = {
  record_id: string; nome_completo: string; patient?: string; codigo: string;
  tipo: string; data: string; hora: string; enabled: boolean; phone_numbers: string[];
  recent_send_count: number; last_sent_at: string | null; history_match_basis: string;
};
type Props = {
  unit: string; revision: number; operate: boolean; busy: boolean;
  act: (path: string, body: unknown) => Promise<unknown>;
  onError: (message: string) => void;
};

export default function CrossImportList({ unit, revision, operate, busy, act, onError }: Props) {
  const [batches, setBatches] = useState<Batch[]>([]), [count, setCount] = useState(0);
  const [page, setPage] = useState(1), [loading, setLoading] = useState(true);
  const [opened, setOpened] = useState<string | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null), [records, setRecords] = useState<CrossRecord[]>([]);
  const [recordPage, setRecordPage] = useState(1), [recordCount, setRecordCount] = useState(0);
  const [search, setSearch] = useState(""), [recentOnly, setRecentOnly] = useState(false);
  const [selected, setSelected] = useState<string[]>([]), [recordsLoading, setRecordsLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setPage(1); setOpened(null); }, [unit]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    request<Paginated<Batch>>(query("sheet-imports", { unit, page: String(page) }))
      .then((data) => { if (active) { setBatches(data.results); setCount(data.count); } })
      .catch((e: Error) => active && onError(e.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [unit, revision, page, onError]);
  useEffect(() => {
    if (!opened) return;
    let active = true;
    setRecordsLoading(true); setSelected([]);
    Promise.all([
      request<Batch>(query(`sheet-imports/${opened}`, { unit })),
      request<Paginated<CrossRecord>>(query(`sheet-imports/${opened}/records`, {
        unit, page: String(recordPage), search, recent_only: String(recentOnly),
      })),
    ]).then(([current, rows]) => { if (active) { setBatch(current); setRecords(rows.results); setRecordCount(rows.count); setError(""); } })
      .catch((e: Error) => active && setError(e.message))
      .finally(() => active && setRecordsLoading(false));
    return () => { active = false; };
  }, [opened, unit, revision, recordPage, search, recentOnly]);
  async function toggleBatch(current: Batch) {
    setError("");
    try { await act(`sheet-imports/${current.id}/activation`, { version: current.version, enabled: !current.control_status.enabled }); }
    catch (e) { setError((e as Error).message); }
  }
  async function toggleRecords(ids: string[], enabled: boolean) {
    if (!batch) return;
    setError("");
    try { await act(`sheet-imports/${batch.id}/record-activation`, { version: batch.version, records: ids, enabled }); setSelected([]); }
    catch (e) { setError((e as Error).message); }
  }
  function open(current: Batch) {
    setBatch(current); setOpened(current.id); setRecords([]); setRecordPage(1);
    setSearch(""); setRecentOnly(false); setSelected([]); setError("");
  }
  return <>
    <article className="op-card cross-batch-directory">
      <div className="cross-batch-heading"><h3>Importações <span className="op-muted">({count})</span></h3></div>
      {error && !opened && <div className="inline-error" role="alert">{error}</div>}
      <div className="table-scroll"><table className="directory-table">
        <thead><tr><th>Importação</th><th>Registros</th><th>Envios</th><th>Programação</th><th>Situação</th><th>Ações</th></tr></thead>
        <tbody>{batches.map((current) => {
          const state = current.control_status;
          const sent = ["accepted", "sent", "delivered", "read"].reduce((sum, key) => sum + (state.message_counts[key] || 0), 0);
          return <tr key={current.id}>
            <td><strong>{current.filename || "Planilha"}</strong><small>{current.layout_name}</small><small>{current.template_name || "Sem template"}</small>
              {current.errors.length > 0 && <small className="cross-error-text">{current.errors.length} erros</small>}
            </td>
            <td><strong>{current.row_count}</strong><small>{state.enabled_count} ativos · {state.disabled_count} desativados</small></td>
            <td>{sent} enviados<small>{state.message_counts.queued || 0} na fila</small></td>
            <td>{state.enabled && state.scheduled_for ? dateTime(state.scheduled_for) : "—"}
              {state.enabled && state.unit_paused && <small>Unidade pausada</small>}</td>
            <td><span className={`directory-status ${state.enabled ? "active" : "paused"}`}>{state.enabled ? "Ativada" : "Desativada"}</span></td>
            <td><div className="cross-row-actions">
              <button className="button" onClick={() => open(current)}><Eye size={15} /> Ver registros</button>
              {operate && <button className="button" disabled={busy || loading || (!state.enabled && (!!current.errors.length || !current.template_name))} onClick={() => void toggleBatch(current)}>
                {state.enabled ? <Pause size={15} /> : <Play size={15} />}{state.enabled ? "Desativar" : "Ativar · +30 min"}
              </button>}
            </div></td>
          </tr>;
        })}</tbody>
      </table></div>
      {!loading && !batches.length && <p className="op-muted">Nenhuma importação.</p>}
      {loading && <p role="status">Carregando importações…</p>}
      {count > 50 && <div className="cross-batch-pagination"><button className="button" disabled={loading || page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page} de {Math.ceil(count / 50)}</span><button className="button" disabled={loading || page * 50 >= count} onClick={() => setPage(page + 1)}>Próxima</button></div>}
    </article>
    {opened && batch && <InlineDialog title={batch.filename || "Registros da importação"} subtitle={`${batch.layout_name} · ${batch.row_count} registros`} busy={busy} onClose={() => setOpened(null)} className="cross-records-modal"
      footer={<><span>{recordCount} registros · Página {recordPage} de {Math.max(1, Math.ceil(recordCount / 50))}</span><button className="button" disabled={recordsLoading || recordPage <= 1} onClick={() => setRecordPage(recordPage - 1)}>Anterior</button><button className="button" disabled={recordsLoading || recordPage * 50 >= recordCount} onClick={() => setRecordPage(recordPage + 1)}>Próxima</button><button className="button" disabled={busy} onClick={() => setOpened(null)}>Fechar</button></>}>
      <div className="cross-record-toolbar">
        <input aria-label="Buscar paciente ou código" placeholder="Buscar paciente ou código" value={search} onChange={(e) => { setSearch(e.target.value); setRecordPage(1); }} />
        <label className="op-check"><input type="checkbox" checked={recentOnly} onChange={(e) => { setRecentOnly(e.target.checked); setRecordPage(1); }} /> Envio nos últimos 30 dias</label>
        {operate && <><button className="button" disabled={busy || recordsLoading || !selected.length} onClick={() => void toggleRecords(selected, true)}>Ativar selecionados</button><button className="button" disabled={busy || recordsLoading || !selected.length} onClick={() => void toggleRecords(selected, false)}>Desativar selecionados</button></>}
      </div>
      {error && <div className="inline-error" role="alert">{error}</div>}
      {recordsLoading && <p role="status">Carregando registros…</p>}
      <div className="table-scroll"><table className="directory-table">
        <thead><tr>{operate && <th><input type="checkbox" aria-label="Selecionar registros desta página" disabled={recordsLoading || !records.length} checked={!!records.length && records.every((row) => selected.includes(row.record_id))} onChange={(e) => setSelected(e.target.checked ? records.map((row) => row.record_id) : [])} /></th>}<th>Paciente</th><th>Categoria / procedimento</th><th>Contatos</th><th>Último envio na categoria</th><th>Situação</th>{operate && <th>Ação</th>}</tr></thead>
        <tbody>{records.map((row) => <tr key={row.record_id} className={row.recent_send_count ? "cross-recent-row" : ""}>
          {operate && <td><input type="checkbox" aria-label={`Selecionar ${row.nome_completo || row.patient}`} disabled={busy || recordsLoading} checked={selected.includes(row.record_id)} onChange={(e) => setSelected((ids) => e.target.checked ? [...ids, row.record_id] : ids.filter((id) => id !== row.record_id))} /></td>}
          <td><strong>{row.nome_completo || row.patient}</strong><small>{row.codigo || row.record_id}</small></td>
          <td>{row.tipo || "—"}<small>{[row.data, row.hora].filter(Boolean).join(" · ")}</small></td>
          <td>{(row.phone_numbers || []).map((phone) => <small key={phone}>{phone}</small>)}</td>
          <td>{row.recent_send_count ? <span className="cross-recent-badge"><AlertTriangle size={14} />{dateTime(row.last_sent_at!)}<small>{row.recent_send_count} envios em menos de 30 dias</small></span> : "—"}</td>
          <td><span className={`directory-status ${row.enabled ? "active" : "paused"}`}>{row.enabled ? "Ativo" : "Desativado"}</span></td>
          {operate && <td><button className="button" disabled={busy || recordsLoading} onClick={() => void toggleRecords([row.record_id], !row.enabled)}>{row.enabled ? "Desativar" : "Ativar"}</button></td>}
        </tr>)}</tbody>
      </table></div>
      {!recordsLoading && !records.length && <p className="op-muted">Nenhum registro encontrado.</p>}
    </InlineDialog>}
  </>;
}
