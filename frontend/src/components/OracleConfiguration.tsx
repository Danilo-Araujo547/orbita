import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Database, LockKeyhole, PlugZap } from "lucide-react";
import { request } from "../api";
import { dateTime } from "../format";
import FormAction from "./FormAction";
import { Panel } from "./ui";

type Details = {
  host: string;
  port: number;
  identifier_type: string;
  identifier: string;
  username: string;
  timeout_ms: number;
};
export type OracleConfig = {
  unit: string;
  version: number;
  configured: boolean;
  legacy_configured: boolean;
  unlocked: boolean;
  unlocked_until: string | null;
  protected_by: string;
  validation_state: string;
  checked_at: string | null;
  details: Details | null;
  client_mode: string;
};

export default function OracleConfiguration({ unit }: { unit: string }) {
  const [config, setConfig] = useState<OracleConfig | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const url = `/api/v1/oracle-configuration/`;
  useEffect(() => {
    let active = true;
    const load = () =>
      request<OracleConfig>(`${url}?unit=${encodeURIComponent(unit)}`)
        .then((data) => {
          if (active) setConfig(data);
        })
        .catch((e: Error) => {
          if (active) setError(e.message);
        });
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 60000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [unit]);

  async function action(operation: string, body: Record<string, unknown> = {}) {
    if (!config) return;
    setBusy(true);
    setError("");
    try {
      const result = await request<OracleConfig>(
        `${url}${operation}/?unit=${encodeURIComponent(unit)}`,
        "POST",
        { version: config.version, ...body },
      );
      setConfig(result);
      setRevision((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>, operation: string) {
    event.preventDefault();
    const data: Record<string, unknown> = Object.fromEntries(
      new FormData(event.currentTarget),
    );
    if (operation === "configure") {
      data.port = Number(data.port);
      data.timeout_ms = Number(data.timeout_ms);
    }
    void action(operation, data);
  }
  const details = config?.details;
  return (
    <Panel title="Oracle">
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {!config ? (
        <p>Carregando configuração…</p>
      ) : (
        <>
          <div className="oracle-summary">
            <div className="setting-row">
              <span>
                <Database size={16} /> Conexão
              </span>
              <strong>
                {config.configured
                  ? config.unlocked
                    ? "Desbloqueada"
                    : "Bloqueada"
                  : config.legacy_configured
                    ? "Ativa · configuração do servidor"
                    : "Não configurada"}
              </strong>
            </div>
            {config.configured && (
              <>
                <div className="setting-row">
                  <span>Protegida por</span>
                  <strong>{config.protected_by}</strong>
                </div>
                {config.unlocked_until && (
                  <div className="setting-row">
                    <span>Desbloqueada até</span>
                    <strong>{dateTime(config.unlocked_until)}</strong>
                  </div>
                )}
                {details && (
                  <>
                    <div className="setting-row">
                      <span>Servidor</span>
                      <strong>
                        {details.host}:{details.port}
                      </strong>
                    </div>
                    <div className="setting-row">
                      <span>
                        {details.identifier_type === "sid"
                          ? "SID"
                          : "Service name"}
                      </span>
                      <strong>{details.identifier}</strong>
                    </div>
                    <div className="setting-row">
                      <span>Usuário Oracle</span>
                      <strong>{details.username}</strong>
                    </div>
                  </>
                )}
                <div className="setting-row">
                  <span>Último teste</span>
                  <strong>
                    {config.validation_state === "connected"
                      ? "Conexão validada"
                      : config.validation_state === "connection_failed"
                        ? "Falha de conexão — confira os dados e o acesso à rede"
                        : "Não realizado"}
                    {config.checked_at
                      ? ` · ${dateTime(config.checked_at)}`
                      : ""}
                  </strong>
                </div>
              </>
            )}
            <div className="setting-row">
              <span>Cliente Oracle do servidor</span>
              <strong>{config.client_mode}</strong>
            </div>
          </div>
          <div className="oracle-actions">
            <FormAction
              title="Configuração Oracle"
              label={
                config.configured
                  ? "Editar configuração Oracle"
                  : "Adicionar conexão Oracle"
              }
              version={revision}
              error={error}
              busy={busy}
            >
              <form
                onSubmit={(event) => submit(event, "configure")}
                className="oracle-config-form"
              >
                <label>
                  Servidor / endereço
                  <input
                    name="host"
                    required
                    maxLength={253}
                    defaultValue={details?.host ?? ""}
                    placeholder="172.19.0.250"
                  />
                </label>
                <label>
                  Porta
                  <input
                    name="port"
                    type="number"
                    required
                    min={1}
                    max={65535}
                    defaultValue={details?.port ?? 1521}
                  />
                </label>
                <label>
                  Tipo de identificador
                  <select
                    name="identifier_type"
                    defaultValue={details?.identifier_type ?? "service"}
                  >
                    <option value="service">Service name</option>
                    <option value="sid">SID</option>
                  </select>
                </label>
                <label>
                  Identificador do banco
                  <input
                    name="identifier"
                    required
                    maxLength={128}
                    defaultValue={details?.identifier ?? ""}
                  />
                </label>
                <label>
                  Usuário Oracle
                  <input
                    name="username"
                    required
                    maxLength={128}
                    autoComplete="off"
                    defaultValue={details?.username ?? ""}
                  />
                </label>
                <label>
                  Senha Oracle
                  <input
                    name="password"
                    type="password"
                    required
                    maxLength={1024}
                    autoComplete="new-password"
                  />
                </label>
                <label>
                  Limite por consulta (milissegundos)
                  <input
                    name="timeout_ms"
                    type="number"
                    required
                    min={1000}
                    max={120000}
                    defaultValue={details?.timeout_ms ?? 30000}
                  />
                </label>
                <label>
                  Sua senha de administrador
                  <input
                    name="admin_password"
                    type="password"
                    required
                    maxLength={1024}
                    autoComplete="current-password"
                  />
                </label>

                <button
                  type="submit"
                  className="button primary"
                  disabled={busy}
                >
                  Salvar configuração
                </button>
              </form>
            </FormAction>
            {config.configured && !config.unlocked && (
              <FormAction
                title="Desbloquear Oracle"
                label="Desbloquear conexão"
                version={revision}
                error={error}
                busy={busy}
              >
                <form
                  className="oracle-unlock-form"
                  onSubmit={(event) => submit(event, "unlock")}
                >
                  <p>Administrador: {config.protected_by}</p>
                  <label>
                    Senha do administrador
                    <input
                      name="admin_password"
                      type="password"
                      required
                      autoComplete="current-password"
                    />
                  </label>
                  <button
                    type="submit"
                    className="button primary"
                    disabled={busy}
                  >
                    Desbloquear
                  </button>
                </form>
              </FormAction>
            )}
            {config.unlocked && (
              <div className="oracle-direct-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void action("test")}
                >
                  <PlugZap size={16} /> Testar conexão
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void action("lock")}
                >
                  <LockKeyhole size={16} /> Bloquear
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}
