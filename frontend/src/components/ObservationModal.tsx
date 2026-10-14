import { useEffect, useRef, useState } from "react";
import InlineDialog from "./InlineDialog";
import { query, request } from "../api";
import { dateTime } from "../format";
import type { Paginated } from "../types";

export type SaveObservationOptions = {
  interlocutor?: string;
  resolveCase?: boolean;
};

type Note = {
  id: number;
  text: string;
  actor_name: string;
  occurred_at: string;
  interlocutor?: string;
};
export default function ObservationModal({
  unit,
  trackingId,
  patient,
  canEdit,
  save,
  onClose,
}: {
  unit: string;
  trackingId: string;
  patient: string;
  canEdit: boolean;
  save: (
    version: number,
    text: string,
    options?: SaveObservationOptions,
  ) => Promise<unknown>;
  onClose: () => void;
}) {
  const [text, setText] = useState(""),
    [interlocutor, setInterlocutor] = useState(""),
    [resolveCase, setResolveCase] = useState(true),
    [version, setVersion] = useState<number | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState(1);
  const [history, setHistory] = useState<Paginated<Note>>({
    count: 0,
    results: [],
    next: null,
    previous: null,
  });
  const submitLock = useRef(false);
  useEffect(() => {
    let active = true;
    Promise.all([
      request<{ version: number }>(query(`cases/${trackingId}`, { unit })),
      request<Paginated<Note>>(
        query(`cases/${trackingId}/timeline`, {
          unit,
          kind: "note",
          page: String(page),
        }),
      ),
    ])
      .then(([current, notes]) => {
        if (active) {
          setVersion(current.version);
          setHistory(notes);
        }
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [unit, trackingId, page]);
  return (
    <InlineDialog
      title="Observações"
      subtitle={patient}
      busy={busy}
      onClose={onClose}
      className="observation-modal"
      footer={
        <footer className="observation-footer">
          <div className="op-modal-actions">
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={onClose}
            >
              {canEdit ? "Cancelar" : "Fechar"}
            </button>
            {canEdit && (
              <button
                form="observation-form"
                className="button primary"
                disabled={busy || version === null || text.trim().length < 3}
              >
                {busy
                  ? "Salvando…"
                  : resolveCase
                    ? "Salvar e resolver caso"
                    : "Salvar observação"}
              </button>
            )}
          </div>
        </footer>
      }
    >
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {canEdit && (
        <form
          id="observation-form"
          className="op-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (version === null || submitLock.current) return;
            submitLock.current = true;
            setBusy(true);
            setError("");
            try {
              await save(version, text.trim(), {
                interlocutor: interlocutor.trim() || undefined,
                resolveCase,
              });
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
              submitLock.current = false;
            }
          }}
        >
          <label className="op-field">
            <span>Nova observação</span>
            <textarea
              autoFocus
              rows={4}
              minLength={3}
              maxLength={4000}
              required
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Registre a observação do agendamento"
            />
          </label>
          <div className="observation-input-meta">
            <span>Até 4.000 caracteres</span>
            <span>{text.length}/4.000</span>
          </div>

          <div className="observation-extra-fields">
            <label className="op-field">
              <span>Com quem falou (opcional)</span>
              <input
                type="text"
                maxLength={200}
                value={interlocutor}
                onChange={(e) => setInterlocutor(e.target.value)}
                placeholder="Ex.: Próprio paciente, Maria (mãe), etc."
              />
            </label>

            <div className="observation-resolve-check">
              <label className="op-checkbox-field">
                <input
                  type="checkbox"
                  checked={resolveCase}
                  onChange={(e) => setResolveCase(e.target.checked)}
                />
                <span>Resolver o caso ao adicionar a observação</span>
              </label>
            </div>
          </div>
        </form>
      )}
      <section
        className="observation-history"
        aria-label="Histórico de observações"
      >
        <h3>
          Histórico <span>{history.count}</span>
        </h3>
        <div className="observation-history-list">
          {history.results.map((note) => {
            const isResolved = /^\[(Caso resolvido|Resolvido)\]/i.test(
              note.text,
            );
            const cleanText = note.text.replace(
              /^\[(Caso resolvido|Resolvido)\]\s*/i,
              "",
            );
            return (
              <article className="op-note-history" key={note.id}>
                <div className="observation-note-meta">
                  <div className="observation-note-actor">
                    <strong>{note.actor_name || "Sistema"}</strong>
                    {note.interlocutor && (
                      <span className="observation-interlocutor-badge">
                        Falou com: <em>{note.interlocutor}</em>
                      </span>
                    )}
                    {isResolved && (
                      <span className="observation-resolved-badge">
                        Resolvido
                      </span>
                    )}
                  </div>
                  <time>{dateTime(note.occurred_at)}</time>
                </div>
                <p>{cleanText}</p>
              </article>
            );
          })}
          {!history.results.length && (
            <p className="op-muted">
              {version === null
                ? "Carregando…"
                : "Nenhuma observação registrada."}
            </p>
          )}
        </div>
        {(history.next || history.previous) && (
          <div className="op-pager">
            <button
              className="button"
              disabled={!history.previous}
              onClick={() => setPage((v) => v - 1)}
            >
              Anteriores
            </button>
            <span>Página {page}</span>
            <button
              className="button"
              disabled={!history.next}
              onClick={() => setPage((v) => v + 1)}
            >
              Próximas
            </button>
          </div>
        )}
      </section>
    </InlineDialog>
  );
}
