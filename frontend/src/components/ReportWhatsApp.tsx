import { useEffect, useRef, useState } from "react";
import { QrCode, RefreshCw, Settings2, ListTree, Wifi, WifiOff } from "lucide-react";
import InlineDialog from "./InlineDialog";
import { query, request } from "../api";
type Config = {
  version: number;
  greeting: string;
  menu_title: string;
  menu_button: string;
  menu_section: string;
  sends_enabled: boolean;
  manual_enabled: boolean;
  automatic_enabled: boolean;
};
type State = {
  configuration: Config;
  global_sends_enabled: boolean;
  status: {
    state: string;
    qr?: string;
    qr_expires_at?: number;
    account?: string;
    logs: { id: number; time: string; event: string }[];
  };
};
const states: Record<string, string> = {
  disconnected: "Desconectado",
  connecting: "Conectando",
  qr: "Aguardando leitura do QR Code",
  connected: "Conectado",
  logged_out: "Sessão encerrada",
  unavailable: "Serviço indisponível",
};
const events: Record<string, string> = {
  connecting: "Conexão iniciada",
  qr_ready: "QR Code atualizado",
  connected: "Conta conectada",
  disconnected: "Conexão interrompida",
  logged_out: "Conta desvinculada no WhatsApp",
  operator_disconnected: "Desconectado pelo administrador",
  inbound_disabled: "Solicitação ignorada: atendimento desativado",
  inbound_processed: "Solicitação processada",
  inbound_expired: "Solicitação expirada",
  unresolved_sender: "Identificação do contato pendente",
  callback_unavailable: "API de relatórios indisponível",
  sent: "Envio aceito pelo WhatsApp",
  list_accepted: "Lista aceita pelo WhatsApp; entrega não confirmada",
  outbound_delivered: "Entrega confirmada pelo WhatsApp",
  outbound_read: "Leitura confirmada pelo WhatsApp",
  send_blocked_policy: "Envio bloqueado pelas permissões ou configuração",
  send_uncertain: "Resultado do envio incerto",
  auth_storage_error: "Falha ao salvar sessão",
  connection_error: "Falha na conexão",
  restore_failed: "Falha ao restaurar sessão",
  inbound_parse_error: "Mensagem não reconhecida",
};
export default function ReportWhatsApp({ unit }: { unit: string }) {
  const [data, setData] = useState<State | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState(false),
    [flow, setFlow] = useState(false),
    [form, setForm] = useState<Config | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    setData(null);
    setError("");
    setModal(false);
    setBusy(false);
    const load = async () => {
      try {
        const next = await request<State>(query("report-whatsapp", { unit }));
        if (!stopped && generation.current === current) setData(next);
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      } finally {
        if (!stopped) timer = setTimeout(load, 5000);
      }
    };
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [unit]);
  async function action(action: string, values?: Config) {
    const current = generation.current;
    setBusy(true);
    setError("");
    try {
      await request(query("report-whatsapp", { unit }), "POST", {
        action,
        ...values,
      });
      const next = await request<State>(query("report-whatsapp", { unit }));
      if (current === generation.current) {
        setData(next);
        setModal(false);
      }
    } catch (e) {
      if (current === generation.current) setError((e as Error).message);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  if (!data)
    return (
      <div className="report-channel-empty">
        {error || "Carregando conexão…"}
      </div>
    );
  const connected = data.status.state === "connected";
  const pending = ["connecting", "qr"].includes(data.status.state);
  return (
    <section className="report-channel">
      <header className="report-channel-heading">
        <div>
          <h2>WhatsApp · relatórios</h2>
          <span className={`report-state ${connected ? "on" : ""}`}>
            {connected ? <Wifi size={13} /> : <WifiOff size={13} />}{" "}
            {states[data.status.state] || data.status.state}
          </span>
        </div>
        <div className="report-actions">
        <button className="button" onClick={() => {setForm({...data.configuration}); setFlow(true); setModal(true);}}>
          <ListTree size={15} /> Fluxo
        </button>
        <button
          className="button"
          onClick={() => {
            setFlow(false);
            setForm({ ...data.configuration });
            setModal(true);
          }}
        >
          <Settings2 size={15} /> Configurar
        </button>
        </div>
      </header>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      <div className="report-channel-grid">
        <div className="report-channel-pairing">
          {data.status.qr ? (
            <img
              className="report-channel-qr"
              src={data.status.qr}
              alt="QR Code para conectar o WhatsApp de relatórios"
            />
          ) : connected ? (
            <div
              className="report-channel-connected"
              role="img"
              aria-label="Conexão ativa entre o SCV e o WhatsApp"
            >
              <svg
                className="report-channel-connected-canvas"
                viewBox="0 0 280 280"
                fill="none"
                aria-hidden="true"
              >
                <g className="report-channel-connected-grid">
                  <line x1="56" y1="28" x2="56" y2="252" />
                  <line x1="140" y1="28" x2="140" y2="252" />
                  <line x1="224" y1="28" x2="224" y2="252" />
                  <line x1="28" y1="56" x2="252" y2="56" />
                  <line x1="28" y1="140" x2="252" y2="140" />
                  <line x1="28" y1="224" x2="252" y2="224" />
                </g>
                <path
                  className="report-channel-link-track"
                  d="M 84 56 C 160 56, 120 224, 196 224"
                />
                <path
                  className="report-channel-link-dots"
                  d="M 84 56 C 160 56, 120 224, 196 224"
                />
                <path
                  className="report-channel-link-particle"
                  d="M 84 56 C 160 56, 120 224, 196 224"
                  pathLength={100}
                />
                <circle
                  className="report-channel-link-port report-channel-link-port-scv"
                  cx="84"
                  cy="56"
                  r="3.5"
                />
                <circle
                  className="report-channel-link-port report-channel-link-port-wa"
                  cx="196"
                  cy="224"
                  r="3.5"
                />
              </svg>
              <div
                className="report-channel-node report-channel-node-scv"
                aria-hidden="true"
              >
                <img
                  src="/logo.png"
                  alt=""
                  width={36}
                  height={36}
                  draggable={false}
                  decoding="async"
                />
              </div>
              <div
                className="report-channel-node report-channel-node-whatsapp"
                aria-hidden="true"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="34"
                  height="34"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2Z"
                    fill="#25D366"
                  />
                  <path
                    d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2ZM12.05 3.67C14.25 3.67 16.31 4.53 17.87 6.09C19.42 7.65 20.28 9.72 20.28 11.92C20.28 16.46 16.58 20.15 12.04 20.15C10.56 20.15 9.11 19.76 7.85 19L7.55 18.83L4.43 19.65L5.26 16.61L5.06 16.29C4.24 14.97 3.8 13.47 3.8 11.91C3.81 7.37 7.5 3.67 12.05 3.67ZM8.53 7.33C8.37 7.33 8.1 7.39 7.87 7.64C7.65 7.89 7 8.5 7 9.71C7 10.93 7.89 12.1 8 12.27C8.14 12.44 9.76 14.94 12.25 16.01C12.84 16.27 13.3 16.42 13.66 16.53C14.25 16.72 14.79 16.69 15.22 16.63C15.7 16.56 16.68 16.03 16.89 15.45C17.1 14.87 17.1 14.38 17.04 14.27C16.97 14.17 16.81 14.11 16.56 14C16.31 13.86 15.09 13.26 14.87 13.18C14.64 13.1 14.5 13.06 14.31 13.3C14.15 13.55 13.67 14.11 13.53 14.27C13.38 14.44 13.24 14.46 12.99 14.33C12.74 14.21 11.94 13.95 11 13.11C10.26 12.45 9.77 11.64 9.62 11.39C9.5 11.15 9.61 11 9.73 10.89C9.84 10.78 10 10.6 10.1 10.45C10.23 10.31 10.27 10.2 10.35 10.04C10.43 9.87 10.39 9.73 10.33 9.61C10.27 9.5 9.77 8.26 9.56 7.77C9.36 7.29 9.16 7.35 9 7.34C8.86 7.34 8.7 7.33 8.53 7.33Z"
                    fill="#FFFFFF"
                  />
                </svg>
              </div>
            </div>
          ) : (
            <div className="report-channel-qr-placeholder">
              <QrCode size={64} />
              <span>Conecte para gerar o QR Code</span>
            </div>
          )}
          {data.status.account && <strong>+{data.status.account}</strong>}
          <div className="report-actions">
            {!connected && !pending ? (
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void action("connect")}
              >
                <QrCode size={15} /> Conectar
              </button>
            ) : (
              <button
                className="button"
                disabled={busy}
                onClick={() => void action("disconnect")}
              >
                Desconectar
              </button>
            )}
            {pending && (
              <span className="report-channel-wait">
                <RefreshCw size={13} /> Aguardando conexão
              </span>
            )}
          </div>
        </div>
        <div className="report-channel-details">
          <dl>
            <dt>Envios</dt>
            <dd>
              {data.global_sends_enabled && data.configuration.sends_enabled
                ? "Habilitados"
                : "Desativados"}
            </dd>
            <dt>Solicitações por mensagem</dt>
            <dd>
              {data.configuration.manual_enabled
                ? "Habilitadas"
                : "Desativadas"}
            </dd>
            <dt>Programações</dt>
            <dd>
              {data.configuration.automatic_enabled
                ? "Habilitadas"
                : "Desativadas"}
            </dd>
            <dt>Menu inicial</dt>
            <dd className="report-channel-greeting">
              {data.configuration.greeting}
            </dd>
          </dl>
        </div>
      </div>
      <section className="report-channel-logs">
        <h3>Atividade da conexão</h3>
        {data.status.logs?.length ? (
          <ol>
            {data.status.logs.map((l) => (
              <li key={l.id}>
                <time>{new Date(l.time).toLocaleString("pt-BR")}</time>
                <span>{events[l.event] || l.event}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p>Nenhum evento registrado.</p>
        )}
      </section>
      {modal && form && (
        <InlineDialog
          title={flow ? "Fluxo de relatórios" : "WhatsApp de relatórios"}
          subtitle=""
          busy={busy}
          className="report-dialog report-dialog-compact"
          onClose={() => setModal(false)}
          footer={
            <footer className="report-dialog-footer">
              <div className="report-dialog-footer-actions">
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => setModal(false)}
                >
                  Cancelar
                </button>
                <button
                  className="button primary"
                  disabled={busy}
                  type="submit"
                  form="report-channel-settings"
                >
                  Salvar
                </button>
              </div>
            </footer>
          }
        >
          <form
            id="report-channel-settings"
            className="report-editor"
            onSubmit={(e) => {
              e.preventDefault();
              void action("configure", form);
            }}
          >
            {flow && <>
            <label className="op-field"><span>Título da lista</span><input required maxLength={60} value={form.menu_title} onChange={e=>setForm({...form,menu_title:e.target.value})}/></label>
            <label className="op-field"><span>Botão para abrir a lista</span><input required maxLength={20} value={form.menu_button} onChange={e=>setForm({...form,menu_button:e.target.value})}/></label>
            <label className="op-field"><span>Nome da seção</span><input required maxLength={24} value={form.menu_section} onChange={e=>setForm({...form,menu_section:e.target.value})}/></label>
            <label className="op-field">
              <span>Mensagem inicial</span>
              <textarea
                required
                maxLength={1000}
                rows={3}
                value={form.greeting}
                onChange={(e) => setForm({ ...form, greeting: e.target.value })}
              />
            </label>
            <div className="report-flow-preview" aria-label="Prévia do fluxo">
              <strong>{form.menu_title}</strong><p>{form.greeting}</p>
              <span className="button">{form.menu_button}</span>
              <ol><li>Selecionar um relatório autorizado</li><li>Informar os parâmetros</li><li>Receber o documento</li></ol>
            </div>
            </>}
            {!flow && <div className="report-checks">
              {(
                [
                  ["sends_enabled", "Envios"],
                  ["manual_enabled", "Solicitações por mensagem"],
                  ["automatic_enabled", "Programações"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="report-check">
                  <input
                    type="checkbox"
                    checked={form[key]}
                    disabled={!data.global_sends_enabled}
                    onChange={(e) =>
                      setForm({ ...form, [key]: e.target.checked })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            }
            {!flow && !data.global_sends_enabled && (
              <span className="report-warning">
                Envios desativados no ambiente.
              </span>
            )}
          </form>
        </InlineDialog>
      )}
    </section>
  );
}
