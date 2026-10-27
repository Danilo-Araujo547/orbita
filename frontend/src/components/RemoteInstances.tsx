import Select from "./Select";
import { useCallback, useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import {
  Cloud,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  Unplug,
  Pencil,
} from "lucide-react";
import { query, request } from "../api";
import type { Paginated } from "../types";
import { dateTime } from "../format";
import InlineDialog from "./InlineDialog";
import { Panel } from "./ui";

type AccessKey = {
  id: string;
  name: string;
  role: string;
  expires_at: string;
  last_used_at: string | null;
  active: boolean;
  key?: string;
};
type Connection = {
  id: string;
  name: string;
  base_url: string;
  remote_unit: { name: string; slug: string };
  remote_role: string;
  enabled: boolean;
  version: number;
  state: string;
  checked_at: string | null;
  error_code: string;
};
const roles: Record<string, string> = {
  viewer: "Consulta",
  operator: "Operador",
  admin: "Administrador",
};

export default function RemoteInstances({
  unit,
  onChanged,
}: {
  unit: string;
  onChanged: () => Promise<void>;
}) {
  const formId = useId();
  const [keys, setKeys] = useState<AccessKey[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"key" | "connect" | null>(null);
  const [editing, setEditing] = useState<Connection | null>(null);
  const [issued, setIssued] = useState<AccessKey | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [page, setPage] = useState(1);
  const [keyCount, setKeyCount] = useState(0);
  const [connectionPage, setConnectionPage] = useState(1);
  const [connectionCount, setConnectionCount] = useState(0);
  const load = useCallback(async () => {
    const [k, c] = await Promise.all([
      request<Paginated<AccessKey>>(
        query("instance-keys", { unit, page: String(page) }),
      ),
      request<Paginated<Connection>>(
        query("remote-instances", { unit, page: String(connectionPage) }),
      ),
    ]);
    setKeys(k.results);
    setKeyCount(k.count);
    setConnections(c.results);
    setConnectionCount(c.count);
  }, [unit, page, connectionPage]);
  useEffect(() => {
    let active = true;
    void load().catch((e: Error) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [load]);
  async function submitKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const data = await request<AccessKey>(
        query("instance-keys", { unit }),
        "POST",
        {
          name: form.get("name"),
          role: form.get("role"),
          validity_days: Number(form.get("validity_days")),
        },
      );
      setIssued(data);
      setShowKey(false);
      setCopied(false);
      setDialog(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submitConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(
        query(
          editing
            ? `remote-instances/${editing.id}/configure`
            : "remote-instances",
          { unit },
        ),
        "POST",
        {
          version: editing?.version || 0,
          name: form.get("name"),
          base_url: form.get("base_url"),
          key: form.get("key") || "",
        },
      );
      setDialog(null);
      setEditing(null);
      await load();
      await onChanged();
      setNotice(
        "Conexão validada. A unidade remota está disponível no seletor com o ícone de nuvem.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function action(path: string, body = {}) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(query(path, { unit }), "POST", body);
      await load();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel
      title="Instâncias remotas"
      className="remote-settings"
      action={
        <button
          type="button"
          className="button primary"
          onClick={() => {
            setEditing(null);
            setError("");
            setDialog("connect");
          }}
        >
          <Plus size={14} />
          <span>Conectar instância</span>
        </button>
      }
    >
      {(error || notice) && (
        <div className="remote-messages">
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="meta-notice" role="status">
              {notice}
            </p>
          )}
        </div>
      )}

      <div className="remote-section-heading">
        <h3>
          <Cloud size={16} />
          Conexões com outras unidades
          <span className="directory-kind">{connectionCount}</span>
        </h3>
      </div>
      {connections.length ? (
        <div className="table-scroll">
          <table className="directory-table">
            <thead>
              <tr>
                <th>Instância / Unidade</th>
                <th>Servidor</th>
                <th>Permissão</th>
                <th>Situação</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {connections.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>
                      <Cloud size={14} /> {c.name}
                    </strong>
                    <small className="directory-detail directory-code">
                      {c.remote_unit.name}
                    </small>
                  </td>
                  <td>
                    <span className="directory-code">{c.base_url}</span>
                  </td>
                  <td>
                    <span className="directory-kind">
                      {roles[c.remote_role]}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`directory-status ${
                        !c.enabled
                          ? "paused"
                          : c.state === "connected"
                            ? "active"
                            : "paused"
                      }`}
                    >
                      {!c.enabled
                        ? "Desconectada"
                        : c.state === "connected"
                          ? "Validada"
                          : "Indisponível"}
                    </span>
                    <small className="directory-detail">
                      {c.checked_at ? dateTime(c.checked_at) : "Não verificada"}
                      {c.error_code ? ` · ${c.error_code}` : ""}
                    </small>
                  </td>
                  <td>
                    <div className="remote-row-actions">
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy}
                        title={`Verificar ${c.name}`}
                        aria-label={`Verificar ${c.name}`}
                        onClick={() =>
                          void action(`remote-instances/${c.id}/check`, {
                            version: c.version,
                          })
                        }
                      >
                        <RefreshCw size={13} />
                        <span>Verificar</span>
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy}
                        title={`Editar ${c.name}`}
                        aria-label={`Editar ${c.name}`}
                        onClick={() => {
                          setEditing(c);
                          setError("");
                          setDialog("connect");
                        }}
                      >
                        <Pencil size={13} />
                        <span>Editar</span>
                      </button>
                      {c.enabled && (
                        <button
                          type="button"
                          className="button secondary"
                          disabled={busy}
                          title={`Desconectar ${c.name}`}
                          aria-label={`Desconectar ${c.name}`}
                          onClick={() =>
                            void action(`remote-instances/${c.id}/disconnect`, {
                              version: c.version,
                            })
                          }
                        >
                          <Unplug size={13} />
                          <span>Desconectar</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="directory-empty">Nenhuma instância remota conectada.</p>
      )}
      {connectionCount > 50 && (
        <div className="meta-actions">
          <button
            type="button"
            className="button secondary"
            disabled={connectionPage === 1}
            onClick={() => setConnectionPage((p) => p - 1)}
          >
            Anterior
          </button>
          <span className="directory-kind">
            {connectionPage} / {Math.ceil(connectionCount / 50)}
          </span>
          <button
            type="button"
            className="button secondary"
            disabled={connectionPage * 50 >= connectionCount}
            onClick={() => setConnectionPage((p) => p + 1)}
          >
            Próxima
          </button>
        </div>
      )}

      <div className="remote-section-heading">
        <h3>
          <KeyRound size={16} />
          Chaves de acesso emitidas nesta unidade
          <span className="directory-kind">{keyCount}</span>
        </h3>
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            setError("");
            setDialog("key");
            setEditing(null);
          }}
        >
          <Plus size={14} />
          <span>Gerar chave</span>
        </button>
      </div>

      {keys.length > 0 ? (
        <div className="table-scroll">
          <table className="directory-table">
            <thead>
              <tr>
                <th>Identificação</th>
                <th>Permissão</th>
                <th>Validade</th>
                <th>Último uso</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>
                    <strong>{k.name}</strong>
                  </td>
                  <td>
                    <span className="directory-kind">{roles[k.role]}</span>
                  </td>
                  <td>
                    <span
                      className={`directory-status ${k.active ? "active" : "paused"}`}
                    >
                      {k.active ? "Ativa" : "Revogada / Expirada"}
                    </span>
                    <small className="directory-detail">
                      Expira em {dateTime(k.expires_at)}
                    </small>
                  </td>
                  <td>
                    {k.last_used_at ? (
                      dateTime(k.last_used_at)
                    ) : (
                      <span className="directory-detail">Sem uso</span>
                    )}
                  </td>
                  <td>
                    {k.active && (
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy}
                        onClick={() =>
                          void action(`instance-keys/${k.id}/revoke`)
                        }
                      >
                        Revogar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="directory-empty">Nenhuma chave de acesso gerada.</p>
      )}
      {keyCount > 50 && (
        <div className="meta-actions">
          <button
            type="button"
            className="button secondary"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </button>
          <span className="directory-kind">
            {page} / {Math.ceil(keyCount / 50)}
          </span>
          <button
            type="button"
            className="button secondary"
            disabled={page * 50 >= keyCount}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </button>
        </div>
      )}

      {dialog && (
        <InlineDialog
          title={
            dialog === "key"
              ? "Gerar chave de instância"
              : editing
                ? "Editar conexão remota"
                : "Conectar instância remota"
          }
          subtitle={
            dialog === "key"
              ? "Acesso exclusivo à unidade local selecionada"
              : "URL base do servidor de origem e chave emitida lá"
          }
          footer={
            <div className="form-action-footer">
              <button
                type="button"
                disabled={busy}
                className="button"
                onClick={() => setDialog(null)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                form={formId}
                disabled={busy}
                className="button primary"
              >
                {busy
                  ? "Processando…"
                  : dialog === "key"
                    ? "Gerar chave"
                    : "Validar e conectar"}
              </button>
            </div>
          }
          busy={busy}
          onClose={() => setDialog(null)}
        >
          <form
            id={formId}
            className="op-form"
            onSubmit={dialog === "key" ? submitKey : submitConnection}
          >
            <fieldset disabled={busy}>
              {error && (
                <p className="inline-error" role="alert">
                  {error}
                </p>
              )}
              <label className="op-field">
                Identificação
                <input
                  name="name"
                  required
                  maxLength={120}
                  defaultValue={editing?.name || ""}
                  placeholder={
                    dialog === "key"
                      ? "Painel da central"
                      : "SCV Messenger · outra unidade"
                  }
                />
              </label>
              {dialog === "key" ? (
                <>
                  <label className="op-field">
                    Permissão
                    <Select name="role" defaultValue="viewer">
                      <option value="viewer">Consulta</option>
                      <option value="operator">Operador</option>
                      <option value="admin">Administrador</option>
                    </Select>
                  </label>
                  <label className="op-field">
                    Validade em dias
                    <input
                      type="number"
                      name="validity_days"
                      min={1}
                      max={365}
                      defaultValue={90}
                      required
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="op-field">
                    URL da instância
                    <input
                      type="url"
                      name="base_url"
                      required
                      defaultValue={editing?.base_url || ""}
                      placeholder="https://scv-messenger.unidade.exemplo"
                    />
                  </label>
                  <label className="op-field">
                    Chave de acesso
                    <input
                      type="password"
                      name="key"
                      required={!editing}
                      autoComplete="new-password"
                      placeholder={
                        editing
                          ? "Deixe vazio para manter a chave salva"
                          : "orbita_…"
                      }
                    />
                  </label>
                </>
              )}
            </fieldset>
          </form>
        </InlineDialog>
      )}

      {issued && (
        <InlineDialog
          title="Chave gerada"
          subtitle="Copie agora. O segredo não poderá ser consultado novamente."
          onClose={() => setIssued(null)}
        >
          <div className="remote-dialog op-stack">
            <p>
              <strong>{issued.name}</strong> · {roles[issued.role]}
            </p>
            <label className="op-field">
              Chave de acesso
              <input
                type={showKey ? "text" : "password"}
                readOnly
                className="directory-code"
                value={issued.key || ""}
              />
            </label>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            <div className="form-action-footer">
              <button
                type="button"
                className="button secondary"
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? "Ocultar chave" : "Exibir chave"}
              </button>
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  if (!navigator.clipboard) {
                    setShowKey(true);
                    setError(
                      "Cópia automática indisponível neste acesso. Selecione a chave exibida e copie manualmente.",
                    );
                    return;
                  }
                  void navigator.clipboard
                    .writeText(issued.key || "")
                    .then(() => {
                      setCopied(true);
                      setError("");
                    })
                    .catch(() =>
                      setError(
                        "Não foi possível copiar. Selecione o campo e copie manualmente.",
                      ),
                    );
                }}
              >
                <Copy size={14} />
                <span>{copied ? "Chave copiada" : "Copiar chave"}</span>
              </button>
            </div>
          </div>
        </InlineDialog>
      )}
    </Panel>
  );
}
