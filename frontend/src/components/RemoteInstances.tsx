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
    <Panel title="Instâncias remotas" className="remote-settings">
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

      <div className="remote-section-heading">
        <h3>
          <Cloud size={18} />
          Conexões desta unidade
        </h3>
        <button
          className="button primary"
          onClick={() => {
            setEditing(null);
            setError("");
            setDialog("connect");
          }}
        >
          <Plus size={15} />
          Conectar instância
        </button>
      </div>
      {connections.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Instância / unidade</th>
                <th>Servidor</th>
                <th>Permissão</th>
                <th>Conexão</th>
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
                    <small className="meta-template-id">
                      {c.remote_unit.name}
                    </small>
                  </td>
                  <td>{c.base_url}</td>
                  <td>{roles[c.remote_role]}</td>
                  <td>
                    {!c.enabled
                      ? "Desconectada"
                      : c.state === "connected"
                        ? "Validada"
                        : "Indisponível"}
                    <small className="meta-template-id">
                      {c.checked_at ? dateTime(c.checked_at) : "Não verificada"}
                      {c.error_code ? ` · ${c.error_code}` : ""}
                    </small>
                  </td>
                  <td>
                    <div className="remote-row-actions">
                      <button
                        className="icon-button"
                        disabled={busy}
                        aria-label={`Verificar ${c.name}`}
                        onClick={() =>
                          void action(`remote-instances/${c.id}/check`, {
                            version: c.version,
                          })
                        }
                      >
                        <RefreshCw size={16} />
                      </button>
                      <button
                        className="icon-button"
                        disabled={busy}
                        aria-label={`Editar ${c.name}`}
                        onClick={() => {
                          setEditing(c);
                          setError("");
                          setDialog("connect");
                        }}
                      >
                        <Pencil size={16} />
                      </button>
                      {c.enabled && (
                        <button
                          className="icon-button"
                          disabled={busy}
                          aria-label={`Desconectar ${c.name}`}
                          onClick={() =>
                            void action(`remote-instances/${c.id}/disconnect`, {
                              version: c.version,
                            })
                          }
                        >
                          <Unplug size={16} />
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
        <p className="muted-note">Nenhuma instância remota conectada.</p>
      )}
      {connectionCount > 50 && (
        <div className="meta-actions">
          <button
            className="button"
            disabled={connectionPage === 1}
            onClick={() => setConnectionPage((p) => p - 1)}
          >
            Anterior
          </button>
          <span>
            {connectionPage} / {Math.ceil(connectionCount / 50)}
          </span>
          <button
            className="button"
            disabled={connectionPage * 50 >= connectionCount}
            onClick={() => setConnectionPage((p) => p + 1)}
          >
            Próxima
          </button>
        </div>
      )}
      <div className="remote-section-heading">
        <h3>
          <KeyRound size={18} />
          Chaves para acessar esta unidade
        </h3>
        <button
          className="button"
          onClick={() => {
            setError("");
            setDialog("key");
            setEditing(null);
          }}
        >
          <Plus size={15} />
          Gerar chave
        </button>
      </div>

      {keys.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Identificação</th>
                <th>Permissão</th>
                <th>Validade</th>
                <th>Último uso</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td>{roles[k.role]}</td>
                  <td>
                    {dateTime(k.expires_at)}
                    {!k.active && (
                      <small className="meta-template-id">
                        Revogada ou expirada
                      </small>
                    )}
                  </td>
                  <td>
                    {k.last_used_at ? dateTime(k.last_used_at) : "Sem uso"}
                  </td>
                  <td>
                    {k.active && (
                      <button
                        className="button"
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
      )}
      {keyCount > 50 && (
        <div className="meta-actions">
          <button
            className="button"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </button>
          <span>
            {page} / {Math.ceil(keyCount / 50)}
          </span>
          <button
            className="button"
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
            <div className="meta-actions">
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
              <button
                type="button"
                disabled={busy}
                className="button"
                onClick={() => setDialog(null)}
              >
                Cancelar
              </button>
            </div>
          }
          busy={busy}
          onClose={() => setDialog(null)}
        >
          <form
            id={formId}
            className="remote-dialog"
            onSubmit={dialog === "key" ? submitKey : submitConnection}
          >
            <fieldset disabled={busy}>
              {error && (
                <p className="meta-error" role="alert">
                  {error}
                </p>
              )}
              <label>
                Identificação
                <input
                  name="name"
                  required
                  maxLength={120}
                  defaultValue={editing?.name || ""}
                  placeholder={
                    dialog === "key"
                      ? "Painel da central"
                      : "Órbita · outra unidade"
                  }
                />
              </label>
              {dialog === "key" ? (
                <>
                  <label>
                    Permissão
                    <select name="role" defaultValue="viewer">
                      <option value="viewer">Consulta</option>
                      <option value="operator">Operador</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </label>
                  <label>
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
                  <label>
                    URL da instância
                    <input
                      type="url"
                      name="base_url"
                      required
                      defaultValue={editing?.base_url || ""}
                      placeholder="https://orbita.unidade.exemplo"
                    />
                  </label>
                  <label>
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
          <div className="remote-dialog">
            <p>
              {issued.name} · {roles[issued.role]}
            </p>
            <label>
              Chave de acesso
              <input
                type={showKey ? "text" : "password"}
                readOnly
                value={issued.key || ""}
              />
            </label>
            {error && (
              <p className="meta-error" role="alert">
                {error}
              </p>
            )}
            <button className="button" onClick={() => setShowKey((v) => !v)}>
              {showKey ? "Ocultar chave" : "Exibir chave"}
            </button>{" "}
            <button
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
              <Copy size={15} />
              {copied ? "Chave copiada" : "Copiar chave"}
            </button>
          </div>
        </InlineDialog>
      )}
    </Panel>
  );
}
