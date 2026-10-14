import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { query, request } from "../api";
import type { Paginated, Unit } from "../types";
import FormAction from "./FormAction";
import { Panel } from "./ui";

type UnitRow = Unit & { timezone: string };

export default function UnitDirectory({
  unit,
  onChanged,
}: {
  unit: string;
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
  return (
    <Panel
      title="Unidades"
      className="unit-directory"
      action={
        <FormAction
          title="Nova unidade"
          label="Nova unidade"
          version={revision}
          busy={busy}
          error={error}
        >
          <form className="op-form" onSubmit={create}>
            <label className="op-field">
              Nome
              <input name="name" required maxLength={150} autoComplete="off" />
            </label>
            <label className="op-field">
              Identificador
              <input
                name="slug"
                required
                maxLength={50}
                pattern="[a-z0-9-]+"
                autoComplete="off"
              />
            </label>
            <label className="op-field">
              Fuso horário
              <input
                name="timezone"
                required
                defaultValue="America/Sao_Paulo"
              />
            </label>
            <button type="submit" className="button primary">
              Criar unidade
            </button>
          </form>
        </FormAction>
      }
    >
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
                <th>Unidade</th>
                <th>Identificador</th>
                <th>Fuso horário</th>
                <th>Envios</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.slug}>
                  <td>
                    <strong>{row.name}</strong>
                    {row.slug === unit && (
                      <span className="directory-current">Atual</span>
                    )}
                  </td>
                  <td className="directory-code">{row.slug}</td>
                  <td>{row.timezone}</td>
                  <td>
                    <span
                      className={`directory-status ${row.paused ? "paused" : "active"}`}
                    >
                      {row.paused ? "Pausados" : "Ativos"}
                    </span>
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
    </Panel>
  );
}
