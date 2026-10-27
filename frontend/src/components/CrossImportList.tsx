import Select from "./Select";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Eye,
  FileSpreadsheet,
  Pause,
  Phone,
  Play,
  Search,
  X,
} from "lucide-react";
import { query, request } from "../api";
import { dateTime } from "../format";
import type { Paginated } from "../types";
import InlineDialog from "./InlineDialog";

type Batch = {
  id: string;
  filename: string;
  configuration: { source?: { origin?: string; item_type?: string; absence_date?: string } };
  layout_name: string;
  state: string;
  version: number;
  row_count: number;
  template_name: string;
  duplicates: number;
  errors: { line: number; code: string }[];
  control_status: {
    enabled: boolean;
    scheduled_for: string | null;
    enabled_count: number;
    disabled_count: number;
    message_counts: Record<string, number>;
    unit_paused: boolean;
  };
};
type CrossRecord = {
  record_id: string;
  nome_completo: string;
  patient?: string;
  codigo: string;
  tipo: string;
  data: string;
  hora: string;
  enabled: boolean;
  phone_numbers: string[];
  recent_send_count: number;
  last_sent_at: string | null;
  history_match_basis: string;
};
type Props = {
  unit: string;
  revision: number;
  operate: boolean;
  busy: boolean;
  act: (path: string, body: unknown) => Promise<unknown>;
  onError: (message: string) => void;
};

export default function CrossImportList({
  unit,
  revision,
  operate,
  busy,
  act,
  onError,
}: Props) {
  const [batches, setBatches] = useState<Batch[]>([]),
    [count, setCount] = useState(0);
  const [page, setPage] = useState(1),
    [loading, setLoading] = useState(true);
  const [opened, setOpened] = useState<string | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null),
    [records, setRecords] = useState<CrossRecord[]>([]);
  const [recordPage, setRecordPage] = useState(1),
    [recordCount, setRecordCount] = useState(0);
  const [search, setSearch] = useState(""),
    [recentOnly, setRecentOnly] = useState(false);
  const [selected, setSelected] = useState<string[]>([]),
    [recordsLoading, setRecordsLoading] = useState(false);
  const [error, setError] = useState("");
  const [allMatching, setAllMatching] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [itemType, setItemType] = useState("");
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setPage(1);
    setOpened(null);
  }, [unit]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    request<Paginated<Batch>>(query("sheet-imports", { unit, page: String(page), item_type: itemType, origin }))
      .then((data) => {
        if (active) {
          setBatches(data.results);
          setCount(data.count);
        }
      })
      .catch((e: Error) => active && onError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [unit, revision, page, onError, itemType, origin]);

  useEffect(() => {
    if (!opened) return;
    let active = true;
    setRecordsLoading(true);
    setSelected([]);
    Promise.all([
      request<Batch>(query(`sheet-imports/${opened}`, { unit })),
      request<Paginated<CrossRecord>>(
        query(`sheet-imports/${opened}/records`, {
          unit,
          page: String(recordPage),
          search,
          recent_only: String(recentOnly),
        }),
      ),
    ])
      .then(([current, rows]) => {
        if (active) {
          setBatch(current);
          setRecords(rows.results);
          setRecordCount(rows.count);
          setError("");
        }
      })
      .catch((e: Error) => active && setError(e.message))
      .finally(() => active && setRecordsLoading(false));
    return () => {
      active = false;
    };
  }, [opened, unit, revision, recordPage, search, recentOnly]);

  async function toggleBatch(current: Batch) {
    setError("");
    try {
      await act(`sheet-imports/${current.id}/activation`, {
        version: current.version,
        enabled: !current.control_status.enabled,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function toggleRecords(ids: string[], enabled: boolean, bulk = false) {
    if (!batch) return;
    setError("");
    try {
      await act(`sheet-imports/${batch.id}/record-activation`, {
        version: batch.version,
        ...(bulk && allMatching
          ? { all_matching: true, excluded_records: excluded, search, recent_only: recentOnly }
          : { records: ids }),
        enabled,
      });
      setSelected([]);
      setAllMatching(false);
      setExcluded([]);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function open(current: Batch) {
    setBatch(current);
    setOpened(current.id);
    setRecords([]);
    setRecordPage(1);
    setSearch("");
    setRecentOnly(false);
    setSelected([]);
    setError("");
  }

  useEffect(() => {
    setAllMatching(false);
    setExcluded([]);
    setSelected([]);
  }, [opened, unit, search, recentOnly, revision]);

  const selectionCount = allMatching ? Math.max(0, recordCount - excluded.length) : selected.length;
  const isRecordSelected = (id: string) => allMatching ? !excluded.includes(id) : selected.includes(id);
  const totalRecordPages = Math.max(1, Math.ceil(recordCount / 50));
  const allPageSelected =
    !!records.length && records.every((row) => isRecordSelected(row.record_id));

  return (
    <>
      <article className="op-card cross-batch-directory">
        <div className="cross-batch-heading">
          <h3>
            Importações <span className="op-muted">({count})</span>
          </h3>
        </div>
        {error && !opened && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        <div className="cross-records-filters">
          <label>Origem
            <Select aria-label="Filtrar origem" value={origin} onChange={(e) => { setOrigin(e.target.value); setPage(1); }}>
              <option value="">Todas</option><option value="sheet">Planilha</option><option value="oracle">Oracle</option>
            </Select>
          </label>
          <label>Tipo de agendamento (Oracle)
            <Select aria-label="Filtrar tipo de agendamento Oracle" value={itemType} onChange={(e) => { setItemType(e.target.value); setPage(1); }}>
              <option value="">Todos</option><option value="A">Consulta</option><option value="I">Imagem / Exames</option><option value="L">Laboratório</option>
            </Select>
          </label>
        </div>
        <div className="table-scroll">
          <table className="directory-table">
            <thead>
              <tr>
                <th>Importação</th>
                <th>Registros</th>
                <th>Envios</th>
                <th>Programação</th>
                <th>Situação</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((current) => {
                const state = current.control_status;
                const sent = ["accepted", "sent", "delivered", "read"].reduce(
                  (sum, key) => sum + (state.message_counts[key] || 0),
                  0,
                );
                return (
                  <tr key={current.id}>
                    <td>
                      <strong>{current.filename || "Planilha"}</strong>
                      <small>{current.configuration?.source?.origin === "oracle_absences" ? "Oracle · Sem atendimento vinculado" : "Planilha"}</small>
                      <small>{current.layout_name}</small>
                      <small>{current.template_name || "Sem template"}</small>
                      {current.errors.length > 0 && (
                        <small className="cross-error-text">
                          {current.errors.length} erros
                        </small>
                      )}
                    </td>
                    <td>
                      {state.enabled_count} ativos / {current.row_count}
                      <small>{state.disabled_count} desativados</small>
                    </td>
                    <td>
                      {sent} enviados
                      <small>{state.message_counts.queued || 0} na fila</small>
                      <small>{state.message_counts.failed || 0} falhas</small>
                    </td>
                    <td>
                      {state.scheduled_for
                        ? `Disparo após ${dateTime(state.scheduled_for)}`
                        : "Não programado"}
                      {state.unit_paused && <small>Unidade pausada</small>}
                    </td>
                    <td>
                      <span
                        className={`directory-status ${state.enabled ? "active" : "paused"}`}
                      >
                        {state.enabled ? "Ativada" : "Desativada"}
                      </span>
                    </td>
                    <td>
                      <div className="cross-row-actions">
                        <button className="button" onClick={() => open(current)}>
                          <Eye size={15} /> Ver registros
                        </button>
                        {operate && (
                          <button
                            className="button"
                            disabled={
                              busy ||
                              loading ||
                              (!state.enabled &&
                                (!!current.errors.length || !current.template_name))
                            }
                            onClick={() => void toggleBatch(current)}
                          >
                            {state.enabled ? <Pause size={15} /> : <Play size={15} />}
                            {state.enabled ? "Desativar" : "Ativar · +30 min"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!loading && !batches.length && (
          <p className="op-muted">Nenhuma importação.</p>
        )}
        {loading && <p role="status">Carregando importações…</p>}
        {count > 50 && (
          <div className="cross-batch-pagination">
            <button
              className="button"
              disabled={loading || page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Anterior
            </button>
            <span>
              Página {page} de {Math.ceil(count / 50)}
            </span>
            <button
              className="button"
              disabled={loading || page * 50 >= count}
              onClick={() => setPage(page + 1)}
            >
              Próxima
            </button>
          </div>
        )}
      </article>

      {opened && batch && (
        <InlineDialog
          title={batch.filename || "Registros da importação"}
          subtitle={`${batch.layout_name} · ${batch.row_count} registros`}
          subtitleIcon={<FileSpreadsheet size={14} aria-hidden="true" />}
          busy={busy}
          onClose={() => setOpened(null)}
          className="cross-records-modal"
          footer={
            <footer className="cross-records-footer">
              <span className="cross-records-footer-meta">
                <strong>{recordCount}</strong>{" "}
                {recordCount === 1 ? "registro" : "registros"} · Página{" "}
                <strong>{recordPage}</strong> de <strong>{totalRecordPages}</strong>
              </span>
              <div className="cross-records-footer-actions">
                <button
                  className="button"
                  disabled={recordsLoading || recordPage <= 1}
                  onClick={() => setRecordPage(recordPage - 1)}
                >
                  Anterior
                </button>
                <button
                  className="button"
                  disabled={recordsLoading || recordPage * 50 >= recordCount}
                  onClick={() => setRecordPage(recordPage + 1)}
                >
                  Próxima
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => setOpened(null)}
                >
                  Fechar
                </button>
              </div>
            </footer>
          }
        >
          <div className="cross-records-summary">
            <div className="cross-summary-stat">
              <span className="cross-summary-label">Total no lote</span>
              <strong className="cross-summary-value">{batch.row_count}</strong>
            </div>
            <div className="cross-summary-stat">
              <span className="cross-summary-label">Ativos</span>
              <strong className="cross-summary-value is-active">
                {batch.control_status.enabled_count}
              </strong>
            </div>
            <div className="cross-summary-stat">
              <span className="cross-summary-label">Desativados</span>
              <strong className="cross-summary-value is-muted">
                {batch.control_status.disabled_count}
              </strong>
            </div>
            <div className="cross-summary-stat cross-summary-template">
              <span className="cross-summary-label">Template vinculado</span>
              <strong className="cross-summary-text">
                {batch.template_name || "Sem template"}
              </strong>
            </div>
            <div className="cross-summary-stat cross-summary-status">
              <span className="cross-summary-label">Situação</span>
              <span
                className={`directory-status ${
                  batch.control_status.enabled ? "active" : "paused"
                }`}
              >
                {batch.control_status.enabled ? "Ativada" : "Desativada"}
              </span>
            </div>
          </div>

          <div className="cross-record-toolbar">
            <div className="cross-record-filters">
              <div className="cross-record-search">
                <Search
                  size={15}
                  className="cross-record-search-icon"
                  aria-hidden="true"
                />
                <input
                  aria-label="Buscar paciente ou código"
                  placeholder="Buscar paciente ou código..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setRecordPage(1);
                  }}
                />
                {search && (
                  <button
                    type="button"
                    className="cross-record-search-clear"
                    aria-label="Limpar busca"
                    onClick={() => {
                      setSearch("");
                      setRecordPage(1);
                    }}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              <label
                className={`op-check cross-recent-filter-pill ${
                  recentOnly ? "is-active" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={recentOnly}
                  onChange={(e) => {
                    setRecentOnly(e.target.checked);
                    setRecordPage(1);
                  }}
                />
                <AlertTriangle size={13} aria-hidden="true" />
                <span>Envio nos últimos 30 dias</span>
              </label>
            </div>

            {operate && (
              <div className="cross-record-bulk-actions">
                <button className="button cross-bulk-btn" disabled={busy || recordsLoading || !recordCount}
                  onClick={() => { setAllMatching(true); setExcluded([]); setSelected([]); }}>
                  Selecionar todos ({recordCount})
                </button>
                {selectionCount > 0 && (
                  <button className="button cross-bulk-btn" disabled={busy || recordsLoading}
                    onClick={() => { setAllMatching(false); setExcluded([]); setSelected([]); }}>Limpar seleção</button>
                )}
                {selectionCount > 0 && (
                  <span className="cross-selected-pill">
                    {selectionCount}{" "}
                    {selectionCount === 1 ? "selecionado" : "selecionados"}
                  </span>
                )}
                <button
                  className="button cross-bulk-btn"
                  disabled={busy || recordsLoading || !selectionCount}
                  onClick={() => void toggleRecords(selected, true, true)}
                >
                  <CheckCircle2 size={14} /> Ativar selecionados
                </button>
                <button
                  className="button cross-bulk-btn"
                  disabled={busy || recordsLoading || !selectionCount}
                  onClick={() => void toggleRecords(selected, false, true)}
                >
                  <Pause size={14} /> Desativar selecionados
                </button>
              </div>
            )}
          </div>

          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}

          <div className="cross-records-table-card">
            <div className="table-scroll">
              <table className="directory-table">
                <thead>
                  <tr>
                    {operate && (
                      <th className="cross-col-check">
                        <input type="checkbox" aria-label="Selecionar registros desta página"
                            disabled={busy || recordsLoading || !records.length} checked={allPageSelected}
                            onChange={(e) => {
                              const ids = records.map(row => row.record_id);
                              if (allMatching) setExcluded(current => e.target.checked
                                ? current.filter(id => !ids.includes(id))
                                : [...new Set([...current, ...ids])]);
                              else setSelected(e.target.checked ? ids : []);
                            }} />
                      </th>
                    )}
                    <th>Paciente</th>
                    <th>Categoria / procedimento</th>
                    <th>Contatos</th>
                    <th>Último envio na categoria</th>
                    <th>Situação</th>
                    {operate && <th className="cross-col-action">Ação</th>}
                  </tr>
                </thead>
                <tbody>
                  {records.map((row) => {
                    const isSelected = isRecordSelected(row.record_id);
                    return (
                      <tr
                        key={row.record_id}
                        className={[
                          row.recent_send_count ? "cross-recent-row" : "",
                          isSelected ? "cross-selected-row" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {operate && (
                          <td className="cross-col-check">
                            <input type="checkbox" aria-label={`Selecionar ${row.nome_completo || row.patient}`}
                              disabled={busy || recordsLoading} checked={isSelected}
                              onChange={(e) => {
                                if (allMatching) setExcluded(ids => e.target.checked
                                  ? ids.filter(id => id !== row.record_id)
                                  : [...new Set([...ids, row.record_id])]);
                                else setSelected(ids => e.target.checked
                                  ? [...new Set([...ids, row.record_id])]
                                  : ids.filter(id => id !== row.record_id));
                              }} />
                          </td>
                        )}
                        <td>
                          <div className="cross-record-patient">
                            <strong>{row.nome_completo || row.patient || "—"}</strong>
                            <span className="directory-code">
                              {row.codigo || row.record_id}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="cross-record-proc">
                            <span className="cross-record-type">
                              {row.tipo || "—"}
                            </span>
                            {(row.data || row.hora) && (
                              <small className="cross-record-datetime">
                                <Calendar size={12} aria-hidden="true" />
                                {[row.data, row.hora].filter(Boolean).join(" · ")}
                              </small>
                            )}
                          </div>
                        </td>
                        <td>
                          {row.phone_numbers?.length ? (
                            <div className="cross-phone-list">
                              {row.phone_numbers.map((phone) => (
                                <span key={phone} className="cross-phone-chip">
                                  <Phone size={11} aria-hidden="true" />
                                  {phone}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="op-muted">—</span>
                          )}
                        </td>
                        <td>
                          {row.recent_send_count ? (
                            <div className="cross-recent-badge">
                              <span className="cross-recent-badge-head">
                                <AlertTriangle size={13} aria-hidden="true" />
                                {dateTime(row.last_sent_at!)}
                              </span>
                              <small>
                                {row.recent_send_count}{" "}
                                {row.recent_send_count === 1 ? "envio" : "envios"} em
                                menos de 30 dias
                              </small>
                            </div>
                          ) : (
                            <span className="cross-no-recent">Sem envio recente</span>
                          )}
                        </td>
                        <td>
                          <span
                            className={`directory-status ${
                              row.enabled ? "active" : "paused"
                            }`}
                          >
                            {row.enabled ? "Ativo" : "Desativado"}
                          </span>
                        </td>
                        {operate && (
                          <td className="cross-col-action">
                            <button
                              className="button cross-row-toggle-btn"
                              disabled={busy || recordsLoading}
                              onClick={() =>
                                void toggleRecords([row.record_id], !row.enabled)
                              }
                            >
                              {row.enabled ? (
                                <>
                                  <Pause size={13} /> Desativar
                                </>
                              ) : (
                                <>
                                  <Play size={13} /> Ativar
                                </>
                              )}
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {recordsLoading && (
              <div className="cross-records-state" role="status">
                Carregando registros…
              </div>
            )}
            {!recordsLoading && !records.length && (
              <div className="cross-records-state op-muted">
                Nenhum registro encontrado para os filtros aplicados.
              </div>
            )}
          </div>
        </InlineDialog>
      )}
    </>
  );
}
