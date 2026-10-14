import FormAction from "./FormAction";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Save, ShieldCheck } from "lucide-react";
import { request } from "../api";
import { dateTime } from "../format";
import { Panel } from "./ui";
import InlineDialog from "./InlineDialog";

export type RemoteTemplate = {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  body: string;
  parameters: string[];
  checks: string[];
  components: Record<string, unknown>[];
};
export type MetaConfig = {
  unit: string;
  version: number;
  waba_id: string;
  phone_number_id: string;
  business_id: string;
  app_id: string;
  api_version: string;
  has_access_token: boolean;
  has_app_secret: boolean;
  has_verify_token: boolean;
  sending_enabled: false;
  validation_state: string;
  validation_code: string;
  checked_at: string | null;
  account_name: string;
  display_phone_number: string;
  verified_name: string;
  templates_synced_at: string | null;
  templates: RemoteTemplate[];
};
const errors: Record<string, string> = {
  meta_190: "Token inválido ou expirado. Atualize o token de acesso.",
  meta_10: "O token não tem permissão para consultar esta conta.",
  meta_200:
    "Acesso negado. Confira a permissão whatsapp_business_management e os ativos do usuário.",
  meta_100: "Confira os IDs, a versão da API e o acesso do token à WABA.",
  phone_not_in_waba:
    "O ID do número não pertence à WABA informada ou não está acessível pelo token.",
  waba_mismatch: "A conta retornada não corresponde à WABA configurada.",
  connection_failed: "Falha de conexão com a Meta. Tente novamente.",
  credentials_unreadable:
    "Não foi possível abrir a credencial. Confira a chave de proteção do servidor.",
  validation_timeout: "A consulta excedeu o tempo permitido. Tente novamente.",
  catalog_limit_exceeded:
    "Catálogo excede o limite desta consulta. Nenhuma sincronização parcial foi aplicada.",
};
const status: Record<string, string> = {
  APPROVED: "Aprovado",
  PENDING: "Em análise",
  REJECTED: "Rejeitado",
  PAUSED: "Pausado",
  DISABLED: "Desativado",
};
const secretFields = [
  ["access_token", "Token de acesso", "has_access_token"],
  ["app_secret", "App Secret", "has_app_secret"],
  ["verify_token", "Token de verificação do webhook", "has_verify_token"],
] as const;

export default function MetaConfiguration({ unit }: { unit: string }) {
  const [config, setConfig] = useState<MetaConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<RemoteTemplate | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const url = `/api/v1/meta-configuration/`;
  useEffect(() => {
    let active = true;
    request<MetaConfig>(`${url}?unit=${encodeURIComponent(unit)}`)
      .then((data) => {
        if (active) setConfig(data);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [unit]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config) return;
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = { version: config.version };
    for (const field of [
      "waba_id",
      "phone_number_id",
      "business_id",
      "app_id",
      "api_version",
    ])
      body[field] = form.get(field);
    for (const [field] of secretFields)
      if (form.get(field)) body[field] = form.get(field);
    body.clear_secrets = secretFields
      .filter(([field]) => form.get(`clear_${field}`))
      .map(([field]) => field);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setConfig(
        await request<MetaConfig>(
          `${url}configure/?unit=${encodeURIComponent(unit)}`,
          "POST",
          body,
        ),
      );
      setDirty(false);
      setNotice(
        "Configuração salva nesta unidade. Envio real continua desativado.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function validate() {
    if (!config) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await request<MetaConfig>(
        `${url}validate/?unit=${encodeURIComponent(unit)}`,
        "POST",
        { version: config.version },
      );
      setConfig(data);
      if (data.validation_state === "valid")
        setNotice(
          `WABA e número validados. ${data.templates.length} templates consultados. Nenhuma mensagem enviada.`,
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const templates = (config?.templates || []).filter((t) =>
    `${t.name} ${t.language} ${t.status}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <Panel
      title="Meta · WhatsApp por unidade"
      className="meta-settings"
      action={
        config ? (
          <div className="panel-actions-group">
            <button
              type="button"
              className="button secondary"
              disabled={
                busy ||
                !config.has_access_token ||
                !config.waba_id ||
                !config.phone_number_id
              }
              onClick={() => void validate()}
            >
              <ShieldCheck size={14} />
              <span>{busy ? "Consultando…" : "Validar e consultar"}</span>
            </button>
            <FormAction
              title="Configuração da Meta"
              label={
                config.version
                  ? "Editar configuração"
                  : "Configurar Meta"
              }
              version={config.version}
              error={error}
              busy={busy}
              onClose={() => setDirty(false)}
            >
              <form
                key={config.version}
                onSubmit={save}
                onChange={() => setDirty(true)}
                autoComplete="off"
                className="meta-form op-form"
              >
                <fieldset disabled={busy}>
                  <div className="meta-fields">
                    {(
                      [
                        ["waba_id", "WABA ID"],
                        ["phone_number_id", "Phone Number ID"],
                        ["business_id", "Business ID (opcional)"],
                        ["app_id", "App ID (opcional)"],
                      ] as const
                    ).map(([field, label]) => (
                      <label key={field} className="op-field">
                        {label}
                        <input
                          name={field}
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={40}
                          defaultValue={config[field]}
                        />
                      </label>
                    ))}
                    <label className="op-field">
                      Versão da Graph API
                      <input
                        name="api_version"
                        pattern="v[0-9]{1,3}\.[0-9]{1,2}"
                        required
                        defaultValue={config.api_version}
                        placeholder="v24.0"
                      />
                    </label>
                  </div>
                  <div className="meta-fields meta-secrets">
                    {secretFields.map(([field, label, exists]) => (
                      <div key={field}>
                        <label className="op-field">
                          {label}
                          <input
                            type="password"
                            name={field}
                            autoComplete="new-password"
                            maxLength={field === "access_token" ? 8192 : 1024}
                            placeholder={
                              config[exists]
                                ? "Salvo · deixe vazio para manter"
                                : "Não configurado"
                            }
                          />
                        </label>
                        <small>
                          {config[exists]
                            ? "Credencial salva e protegida"
                            : "Credencial não cadastrada"}
                        </small>
                        {config[exists] && (
                          <label className="meta-clear">
                            <input type="checkbox" name={`clear_${field}`} />
                            Remover credencial salva
                          </label>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="meta-actions">
                    {dirty && (
                      <small>Salve as alterações antes de validar.</small>
                    )}
                  </div>
                </fieldset>
                <button type="submit" className="button primary">
                  <Save size={15} />
                  Salvar configuração
                </button>
              </form>
            </FormAction>
          </div>
        ) : undefined
      }
    >
      {error && (
        <p className="meta-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="meta-notice" role="status">
          {notice}
        </p>
      )}
      {!config ? (
        <p className="directory-empty">
          {error
            ? "Não foi possível carregar a configuração."
            : "Carregando configuração…"}
        </p>
      ) : (
        <>
          <div className="config-overview-banner">
            <div className="overview-item">
              <span className="overview-label">Disparos de mensagens</span>
              <span className="directory-status paused">
                Envio real desativado
              </span>
            </div>
            <div className="overview-item">
              <span className="overview-label">Validação de Acesso</span>
              <span
                className={`directory-status ${
                  config.validation_state === "valid"
                    ? "active"
                    : config.validation_state === "error"
                      ? "paused"
                      : ""
                }`}
              >
                {config.validation_state === "valid"
                  ? "Acesso validado"
                  : config.validation_state === "error"
                    ? "Falha na validação"
                    : "Não validado"}
              </span>
              {config.checked_at && (
                <small className="directory-detail">
                  {dateTime(config.checked_at)}
                </small>
              )}
            </div>
            {config.account_name && (
              <div className="overview-item">
                <span className="overview-label">Conta WhatsApp Business</span>
                <strong>
                  {config.account_name} · {config.display_phone_number}
                </strong>
                {config.verified_name && (
                  <small className="directory-detail">
                    {config.verified_name}
                  </small>
                )}
              </div>
            )}
          </div>

          <div className="config-detail-grid">
            <div className="config-detail-card">
              <span>WABA ID</span>
              <strong className="directory-code">
                {config.waba_id || "Não configurado"}
              </strong>
            </div>
            <div className="config-detail-card">
              <span>Phone Number ID</span>
              <strong className="directory-code">
                {config.phone_number_id || "Não configurado"}
              </strong>
            </div>
            <div className="config-detail-card">
              <span>Token de Acesso</span>
              <div>
                <span
                  className={`directory-status ${
                    config.has_access_token ? "active" : ""
                  }`}
                >
                  {config.has_access_token
                    ? "Salvo e protegido"
                    : "Não configurado"}
                </span>
              </div>
            </div>
            <div className="config-detail-card">
              <span>Graph API</span>
              <strong className="directory-code">{config.api_version}</strong>
            </div>
          </div>

          {config.validation_code && (
            <p className="meta-error" role="alert">
              {errors[config.validation_code] ||
                `Consulta não concluída (${config.validation_code}). Confira o acesso e tente novamente.`}
            </p>
          )}

          <div className="meta-catalog-heading">
            <div>
              <h3>
                Templates da Meta{" "}
                <span className="directory-kind">{config.templates.length}</span>
              </h3>
              <p>
                {config.templates_synced_at
                  ? `Catálogo consultado em ${dateTime(config.templates_synced_at)}`
                  : "O catálogo será carregado após uma validação bem-sucedida."}
              </p>
            </div>
            <label>
              Filtrar templates
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                placeholder="Nome, idioma ou situação"
              />
            </label>
          </div>
          {config.validation_state === "error" &&
            config.templates_synced_at && (
              <p className="directory-detail error-text">
                Exibindo dados da última consulta bem-sucedida.
              </p>
            )}
          {templates.length > 0 ? (
            <div className="table-scroll">
              <table className="directory-table">
                <thead>
                  <tr>
                    <th>Template</th>
                    <th>Idioma</th>
                    <th>Situação na Meta</th>
                    <th>Categoria</th>
                    <th>Verificação local</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.slice(page * 15, (page + 1) * 15).map((t) => (
                    <tr key={t.id}>
                      <td>
                        <strong>{t.name}</strong>
                        <small className="directory-detail directory-code">
                          {t.id}
                        </small>
                      </td>
                      <td>
                        <span className="directory-kind">{t.language}</span>
                      </td>
                      <td>
                        <span
                          className={`directory-status ${
                            t.status === "APPROVED"
                              ? "active"
                              : t.status === "PENDING"
                                ? "paused"
                                : ""
                          }`}
                        >
                          {status[t.status] || t.status}
                        </span>
                      </td>
                      <td>{t.category}</td>
                      <td>
                        {t.checks.length ? (
                          <span className="directory-detail error-text">
                            {t.checks.length} ponto(s) para revisão
                          </span>
                        ) : (
                          <span className="directory-status active">
                            Conferido
                          </span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => setSelected(t)}
                        >
                          Ver template
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="directory-empty">
              {config.templates_synced_at
                ? "Nenhum template encontrado com o filtro atual."
                : "Catálogo não consultado ainda."}
            </p>
          )}
          {templates.length > 15 && (
            <div className="meta-actions">
              <button
                type="button"
                className="button secondary"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Anterior
              </button>
              <span className="directory-kind">
                {page + 1} / {Math.ceil(templates.length / 15)}
              </span>
              <button
                type="button"
                className="button secondary"
                disabled={(page + 1) * 15 >= templates.length}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </button>
            </div>
          )}
        </>
      )}
      {selected && (
        <InlineDialog
          title={selected.name}
          subtitle={`${selected.language} · ${status[selected.status] || selected.status} · ${selected.category}`}
          onClose={() => setSelected(null)}
        >
          <div className="meta-template-detail">
            <h3>Conteúdo</h3>
            <pre>{selected.body || "Sem corpo textual"}</pre>
            <p>
              Variáveis do corpo:{" "}
              {selected.parameters.map((p) => `{{${p}}}`).join(", ") ||
                "Nenhuma"}
            </p>
            {selected.checks.length > 0 && (
              <>
                <h3>Pontos para revisão</h3>
                <ul>
                  {selected.checks.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </>
            )}
            <details>
              <summary>Componentes da Meta</summary>
              <pre>{JSON.stringify(selected.components, null, 2)}</pre>
            </details>
          </div>
        </InlineDialog>
      )}
    </Panel>
  );
}
