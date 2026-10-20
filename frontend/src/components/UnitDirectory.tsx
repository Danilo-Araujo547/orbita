import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { query, request } from "../api";
import type { Paginated, Unit } from "../types";
import FormAction from "./FormAction";

type UnitRow = Unit & { timezone: string; version: number };

export default function UnitDirectory({
  unit,
  editable = true,
  onChanged,
}: {
  unit: string;
  editable?: boolean;
  onChanged?: () => Promise<void>;
}) {
  const [rows, setRows] = useState<UnitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    async function load() {
      const found: UnitRow[] = [];
      let page = 1;
      while (true) {
        const result = await request<Paginated<UnitRow>>(
          query("units", { unit, page: String(page) }),
        );
        found.push(...result.results);
        if (!result.next) break;
        page++;
      }
      if (active) setRows(found);
    }
    load()
      .catch((e: Error) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [unit, revision]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError("");
    try {
      await request(query("units", { unit }), "POST", values);
      setRevision((v) => v + 1);
      if (onChanged) await onChanged();
      else window.location.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function configure(event: FormEvent<HTMLFormElement>, row: UnitRow) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await request(query(`units/${row.id}/configure`, { unit }), "POST", {
        version: row.version,
        name: values.get("name"),
        timezone: values.get("timezone"),
        response_hours: Number(values.get("response_hours")),
        paused: values.get("paused") === "on",
        authorized_recipients: String(values.get("authorized_recipients") || "")
          .split(/[\s,;]+/)
          .filter(Boolean),
      });
      setRevision((v) => v + 1);
      await onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="unit-directory">
      <div className="unit-toolbar">
        <div className="unit-summary">
          <span className="unit-count">
            {loading
              ? "Carregando…"
              : `${rows.length} ${rows.length === 1 ? "unidade cadastrada" : "unidades cadastradas"}`}
          </span>
        </div>
        {editable && (
          <div className="unit-toolbar-actions">
            <FormAction
              title="Nova unidade"
              label="Adicionar unidade"
              version={revision}
              busy={busy}
              error={error}
            >
              <form className="op-form unit-form" onSubmit={create}>
                <div className="unit-form-grid">
                  <label className="op-field unit-field-full">
                    <span>Nome</span>
                    <input
                      name="name"
                      required
                      maxLength={150}
                      autoComplete="off"
                      placeholder="Ex.: Unidade Central"
                    />
                  </label>
                  <label className="op-field">
                    <span>Identificador</span>
                    <input
                      name="slug"
                      required
                      maxLength={50}
                      pattern="[a-z0-9-]+"
                      autoComplete="off"
                      placeholder="ex.: central"
                    />
                  </label>
                  <label className="op-field">
                    <span>Fuso horário</span>
                    <input
                      name="timezone"
                      required
                      defaultValue="America/Sao_Paulo"
                      placeholder="Ex.: America/Sao_Paulo"
                    />
                  </label>
                </div>
                <button type="submit" className="button primary">
                  Criar unidade
                </button>
              </form>
            </FormAction>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}

      {loading ? (
        <p className="directory-empty" role="status">
          Carregando unidades…
        </p>
      ) : (
        <div className="table-scroll">
          <table className="directory-table">
            <thead>
              <tr>
                <th className="unit-col-name">Unidade</th>
                <th className="unit-col-slug">Identificador</th>
                <th className="unit-col-timezone">Fuso horário</th>
                <th className="unit-col-status">Envios</th>
                <th className="unit-col-actions">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.slug}>
                  <td className="unit-col-name">
                    <div className="unit-name-cell">
                      <strong>{row.name}</strong>
                      {row.slug === unit && (
                        <span className="directory-current">Atual</span>
                      )}
                    </div>
                  </td>
                  <td className="unit-col-slug">
                    <span className="directory-code">{row.slug}</span>
                  </td>
                  <td className="unit-col-timezone">{row.timezone}</td>
                  <td className="unit-col-status">
                    <span
                      className={`directory-status ${row.paused ? "paused" : "active"}`}
                    >
                      {row.paused ? "Pausados" : "Ativos"}
                    </span>
                  </td>
                  <td className="unit-col-actions">
                    {editable && (
                      <FormAction
                        title={`Editar ${row.name}`}
                        label="Editar"
                        version={revision}
                        busy={busy}
                        error={error}
                      >
                        <form
                          className="op-form unit-form"
                          onSubmit={(e) => void configure(e, row)}
                        >
                          <div className="unit-form-grid">
                            <label className="op-field unit-field-full">
                              <span>Nome</span>
                              <input
                                name="name"
                                required
                                maxLength={150}
                                defaultValue={row.name}
                              />
                            </label>
                            <label className="op-field">
                              <span>Fuso horário</span>
                              <input
                                name="timezone"
                                required
                                defaultValue={row.timezone}
                              />
                            </label>
                            <label className="op-field">
                              <span>Prazo de resposta (horas)</span>
                              <input
                                name="response_hours"
                                type="number"
                                required
                                min={1}
                                max={168}
                                defaultValue={row.response_hours}
                              />
                            </label>
                          </div>
                          <label className="checkbox-label unit-checkbox-label">
                            <input
                              name="paused"
                              type="checkbox"
                              defaultChecked={row.paused}
                            />
                            <span>Envios pausados</span>
                          </label>
                          <label className="op-field unit-field-full">
                            <span>Destinatários autorizados para teste</span>
                            <textarea
                              name="authorized_recipients"
                              defaultValue={
                                row.effective_recipients?.join("\n") || ""
                              }
                              rows={4}
                              placeholder="Insira um destinatário por linha ou separados por vírgula"
                            />
                          </label>
                          <button
                            type="submit"
                            className="button primary"
                            disabled={busy}
                          >
                            Salvar unidade
                          </button>
                        </form>
                      </FormAction>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <p className="directory-empty">Nenhuma unidade cadastrada.</p>
          )}
        </div>
      )}
    </div>
  );
}
