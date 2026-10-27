import Select from "./Select";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { query, request } from "../api";
import { dateTime, labels } from "../format";
import type { Paginated } from "../types";
import { Badge, Empty, Panel } from "./ui";
import InlineDialog from "./InlineDialog";

type LogEntry = {
  id: string;
  category: string;
  occurred_at: string;
  status: string;
  title: string;
  reference: string;
  recipient: string;
  provider_id: string;
  actor: string;
  error_code: string;
  count: number;
  completed_at: string | null;
};
const categories: Record<string, string> = {
  imports: "Consultas às fontes",
  flows: "Execuções de regras",
  cross: "Importa CROSS",
  messages: "Mensagens · estado atual",
  attempts: "Tentativas de envio",
  events: "Eventos da Meta",
  reports: "Relatórios",
  audit: "Auditoria",
};
const statuses: Record<string, string> = {
  ...labels,
  recorded: "Registrada",
  started: "Iniciada",
  success: "Sucesso",
  error: "Erro",
  simulated: "Simulada",
  succeeded: "Concluída",
};

export default function ExecutionLogs({ unit }: { unit: string }) {
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<Paginated<LogEntry> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<LogEntry | null>(null);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    setData(null);
    const timer = setTimeout(() => {
      request<Paginated<LogEntry>>(
        query("logs", {
          unit,
          category,
          status,
          search,
          start,
          end,
          page: String(page),
        }),
      )
        .then((value) => {
          if (active) setData(value);
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [unit, category, status, search, start, end, page, revision]);
  function change(set: (v: string) => void, value: string) {
    set(value);
    setPage(1);
  }
  return (
    <Panel title="Logs" action={<button className="button" disabled={busy} onClick={() => setRevision(v => v + 1)}><RefreshCw size={15} />Atualizar</button>}>
      <div className="execution-log-filters">
        <label>
          Tipo
          <Select
            value={category}
            onChange={(e) => change(setCategory, e.target.value)}
          >
            <option value="">Todos</option>
            {Object.entries(categories).map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </Select>
        </label>
        <label>
          Situação
          <Select
            value={status}
            onChange={(e) => change(setStatus, e.target.value)}
          >
            <option value="">Todas</option>
            {Object.entries(statuses).map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </Select>
        </label>
        <label>
          De
          <input
            type="date"
            value={start}
            onChange={(e) => change(setStart, e.target.value)}
          />
        </label>
        <label>
          Até
          <input
            type="date"
            value={end}
            onChange={(e) => change(setEnd, e.target.value)}
          />
        </label>
        <label className="execution-log-search">
          Buscar
          <input
            type="search"
            placeholder="Regra, template, número ou código"
            value={search}
            onChange={(e) => change(setSearch, e.target.value)}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {busy && <p role="status">Carregando logs…</p>}
      {data && (
        <>
          <div className="table-scroll">
            <table className="directory-table execution-log-table">
              <thead>
                <tr>
                  <th>Data e hora</th>
                  <th>Tipo</th>
                  <th>Execução</th>
                  <th>Situação</th>
                  <th>Destinatário</th>
                  <th>Responsável</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.results.map((log) => (
                  <tr key={`${log.category}-${log.id}`}>
                    <td>{dateTime(log.occurred_at)}</td>
                    <td>{categories[log.category]}</td>
                    <td>
                      <strong>{log.title}</strong>
                      {log.error_code && (
                        <small className="directory-detail error-text">
                          {log.error_code}
                        </small>
                      )}
                    </td>
                    <td>
                      <Badge value={log.status} />
                    </td>
                    <td>{log.recipient || "—"}</td>
                    <td>{log.actor}</td>
                    <td>
                      <button
                        className="button"
                        onClick={() => setSelected(log)}
                      >
                        Detalhes
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.results.length && <Empty text="Nenhum log encontrado." />}
          <div className="pagination">
            <span>
              {data.count} registros · página {page}
            </span>
            <div>
              <button
                className="button"
                disabled={page === 1 || busy}
                onClick={() => setPage((p) => p - 1)}
              >
                Anterior
              </button>
              <button
                className="button"
                disabled={!data.next || busy}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </button>
            </div>
          </div>
        </>
      )}
      {selected && (
        <InlineDialog
          title="Detalhes do log"
          subtitle=""
          onClose={() => setSelected(null)}
          footer={
            <button className="button" onClick={() => setSelected(null)}>
              Fechar
            </button>
          }
        >
          <dl className="execution-log-details">
            {Object.entries({
              Tipo: categories[selected.category],
              Registro: selected.id,
              Data: dateTime(selected.occurred_at),
              Execução: selected.title,
              Situação: statuses[selected.status] || selected.status,
              Responsável: selected.actor,
              Referência: selected.reference || "—",
              Destinatário: selected.recipient || "—",
              "ID Meta": selected.provider_id || "—",
              [selected.category === "attempts"
                ? "Tentativa"
                : selected.category === "messages"
                  ? "Tentativas"
                  : selected.category === "cross"
                    ? "Duplicidades"
                    : "Registros"]: String(selected.count),
              Código: selected.error_code || "—",
              [selected.category === "messages"
                ? "Entregue em"
                : "Concluído em"]: selected.completed_at
                ? dateTime(selected.completed_at)
                : "—",
            }).map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </InlineDialog>
      )}
    </Panel>
  );
}
