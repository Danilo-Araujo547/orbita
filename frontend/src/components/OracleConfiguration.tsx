import Select from "./Select";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { LockKeyhole, PlugZap } from "lucide-react";
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
  persistent_access: boolean;
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
    <Panel
      title="Oracle"
      action={
        config ? (
          <div className="panel-actions-group">
            {config.unlocked && (
              <>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void action("test")}
                >
                  <PlugZap size={14} />
                  <span>Testar conexão</span>
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void action("lock")}
                >
                  <LockKeyhole size={14} />
                  <span>Desativar conexão</span>
                </button>
              </>
            )}
            {config.configured && !config.unlocked && (
              <FormAction
                title="Ativar conexão Oracle"
                label="Ativar conexão"
                version={revision}
                error={error}
                busy={busy}
              >
                <form
                  className="oracle-unlock-form op-form"
                  onSubmit={(event) => submit(event, "unlock")}
                >
                  <p>
                    Administrador: <strong>{config.protected_by}</strong>
                  </p>
                  <label className="op-field">
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
            <FormAction
              title="Configuração Oracle"
              label={config.configured ? "Editar conexão" : "Adicionar conexão"}
              version={revision}
              error={error}
              busy={busy}
            >
              <form
                onSubmit={(event) => submit(event, "configure")}
                className="oracle-config-form op-form"
              >
                <label className="op-field">
                  Servidor / endereço
                  <input
                    name="host"
                    required
                    maxLength={253}
                    defaultValue={details?.host ?? ""}
                    placeholder="172.19.0.250"
                  />
                </label>
                <label className="op-field">
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
                <label className="op-field">
                  Tipo de identificador
                  <Select
                    name="identifier_type"
                    defaultValue={details?.identifier_type ?? "service"}
                  >
                    <option value="service">Service name</option>
                    <option value="sid">SID</option>
                  </Select>
                </label>
                <label className="op-field">
                  Identificador do banco
                  <input
                    name="identifier"
                    required
                    maxLength={128}
                    defaultValue={details?.identifier ?? ""}
                  />
                </label>
                <label className="op-field">
                  Usuário Oracle
                  <input
                    name="username"
                    required
                    maxLength={128}
                    autoComplete="off"
                    defaultValue={details?.username ?? ""}
                  />
                </label>
                <label className="op-field">
                  Senha Oracle
                  <input
                    name="password"
                    type="password"
                    required
                    maxLength={1024}
                    autoComplete="new-password"
                  />
                </label>
                <label className="op-field">
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
                <label className="op-field">
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
          </div>
        ) : undefined
      }
    >
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {!config ? (
        <p className="directory-empty">Carregando configuração…</p>
      ) : (
        <div className="oracle-status-layout">
          <div className="config-overview-banner">
            <div className="overview-item">
              <span className="overview-label">Status da Conexão</span>
              <span
                className={`directory-status ${
                  config.configured
                    ? config.unlocked
                      ? "active"
                      : "paused"
                    : config.legacy_configured
                      ? "active"
                      : ""
                }`}
              >
                {config.configured
                  ? config.unlocked
                    ? "Ativa"
                    : "Desativada"
                  : config.legacy_configured
                    ? "Ativa · Configuração do servidor"
                    : "Não configurada"}
              </span>
            </div>
            <div className="overview-item">
              <span className="overview-label">Último Teste</span>
              <span
                className={`directory-status ${
                  config.validation_state === "connected"
                    ? "active"
                    : config.validation_state === "connection_failed"
                      ? "paused"
                      : ""
                }`}
              >
                {config.validation_state === "connected"
                  ? "Conexão validada"
                  : config.validation_state === "connection_failed"
                    ? "Falha de conexão"
                    : "Não realizado"}
              </span>
              {config.checked_at && (
                <small className="directory-detail">
                  {dateTime(config.checked_at)}
                </small>
              )}
            </div>
            {config.protected_by && (
              <div className="overview-item">
                <span className="overview-label">Protegida por</span>
                <strong>{config.protected_by}</strong>
              </div>
            )}
            {config.unlocked_until && (
              <div className="overview-item">
                <span className="overview-label">Desbloqueada até</span>
                <strong>{dateTime(config.unlocked_until)}</strong>
              </div>
            )}
            {config.persistent_access && config.unlocked && (
              <div className="overview-item">
                <span className="overview-label">Disponibilidade</span>
                <strong>Contínua</strong>
              </div>
            )}
          </div>

          {details ? (
            <div className="config-detail-grid">
              <div className="config-detail-card">
                <span>Servidor e Porta</span>
                <strong className="directory-code">
                  {details.host}:{details.port}
                </strong>
              </div>
              <div className="config-detail-card">
                <span>
                  {details.identifier_type === "sid" ? "SID" : "Service Name"}
                </span>
                <strong className="directory-code">{details.identifier}</strong>
              </div>
              <div className="config-detail-card">
                <span>Usuário Oracle</span>
                <strong className="directory-code">{details.username}</strong>
              </div>
              <div className="config-detail-card">
                <span>Limite por consulta</span>
                <strong>{details.timeout_ms} ms</strong>
              </div>
              <div className="config-detail-card">
                <span>Driver / Modo Oracle</span>
                <strong>{config.client_mode}</strong>
              </div>
            </div>
          ) : !config.configured && !config.legacy_configured ? (
            <p className="directory-empty">
              Nenhuma conexão Oracle configurada para esta unidade.
            </p>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
