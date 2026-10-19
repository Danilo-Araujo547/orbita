import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { query, request } from "../api";
import type { Paginated, Unit } from "../types";
import FormAction from "./FormAction";
import { Panel } from "./ui";

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
    setBusy(true);setError("");
    try {
      await request(query(`units/${row.id}/configure`, {unit}), "POST", {
        version:row.version, name:values.get("name"), timezone:values.get("timezone"),
        response_hours:Number(values.get("response_hours")), paused:values.get("paused")==="on",
        authorized_recipients:String(values.get("authorized_recipients")||"").split(/[\s,;]+/).filter(Boolean),
      });
      setRevision(v=>v+1); await onChanged?.();
    } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  return (
    <Panel
      title="Unidades"
      className="unit-directory"
      action={
        editable && <FormAction
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
                <th>Ações</th>
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
                  <td>{editable && <FormAction title="Editar unidade" label="Editar" version={revision} busy={busy} error={error}>
                    <form className="op-form" onSubmit={e=>void configure(e,row)}>
                      <label className="op-field">Nome<input name="name" required maxLength={150} defaultValue={row.name}/></label>
                      <label className="op-field">Fuso horário<input name="timezone" required defaultValue={row.timezone}/></label>
                      <label className="op-field">Prazo de resposta (horas)<input name="response_hours" type="number" required min={1} max={168} defaultValue={row.response_hours}/></label>
                      <label className="checkbox-label"><input name="paused" type="checkbox" defaultChecked={row.paused}/>Envios pausados</label>
                      <label className="op-field">Destinatários autorizados para teste<textarea name="authorized_recipients" defaultValue={row.effective_recipients?.join("\n") || ""} rows={4}/></label>
                      <button type="submit" className="button primary" disabled={busy}>Salvar unidade</button>
                    </form>
                  </FormAction>}</td>
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
