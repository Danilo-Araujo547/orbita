import { useEffect, useState } from "react";
import {
  Check,
  Clock3,
  FlaskConical,
  MessageCircle,
  Plus,
  Send,
  Settings2,
  ShieldCheck,
  TriangleAlert,
  User,
} from "lucide-react";
import { dateTime, kinds } from "../format";
import type { Control, Message, Modal } from "../types";
import { Badge } from "./ui";
import { query, request } from "../api";
import type { Paginated } from "../types";

export default function ModalContent({
  modal,
  control,
  messages,
  role,
  busy,
  mutate,
}: {
  modal: NonNullable<Modal>;
  control: Control;
  messages: Message[];
  role: string;
  busy: boolean;
  mutate: (path: string, body: unknown, message: string) => Promise<void>;
}) {
  const [resolution, setResolution] = useState(""),
    [classification, setClassification] = useState(""),
    [linkedMessage, setLinkedMessage] = useState("");
  const [testPhone, setTestPhone] = useState(control.test_recipients[0] || ""),
    [testKind, setTestKind] = useState("consultation");
  const [ruleForm, setRuleForm] = useState(
    modal.type === "rule" ? { ...modal.value } : null,
  );
  const [templateForm, setTemplateForm] = useState(
    modal.type === "template" ? { ...modal.value } : null,
  );
  const canOperate = role === "admin" || role === "operator";
  const [candidates, setCandidates] = useState(messages);
  const [candidateError, setCandidateError] = useState("");
  useEffect(() => {
    if (modal.type !== "issue" || modal.value.message || !modal.value.sender)
      return;
    let active = true;
    request<Paginated<Message>>(
      query("messages", {
        unit: control.unit.slug,
        search: modal.value.sender,
      }),
    )
      .then((result) => {
        if (active) setCandidates(result.results);
      })
      .catch((error) => {
        if (active) setCandidateError((error as Error).message);
      });
    return () => {
      active = false;
    };
  }, [modal, control.unit.slug]);
  if (modal.type === "test")
    return (
      <>
        <span className="modal-eyebrow">
          <FlaskConical size={17} />
          TESTE INDIVIDUAL
        </span>
        <h2>Validar um lembrete</h2>

        <label>
          Número autorizado
          <select
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
          >
            <option value="">Selecione um número</option>
            {control.test_recipients.map((phone) => (
              <option key={phone} value={phone}>
                +{phone}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tipo de agendamento
          <select
            value={testKind}
            onChange={(e) => setTestKind(e.target.value)}
          >
            {Object.entries(kinds).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {!control.test_recipients.length && (
          <div className="inline-error">
            Nenhum número foi autorizado no ambiente. Configure TEST_RECIPIENTS
            para continuar.
          </div>
        )}
        <div className="modal-note">
          <ShieldCheck size={17} />
          <span>
            Criar o teste prepara a mensagem na fila. O envio é uma ação
            separada.
          </span>
        </div>
        <button
          className="button primary"
          disabled={busy || !testPhone}
          onClick={() =>
            void mutate(
              "tests/appointments",
              { phone: testPhone, kind: testKind },
              "Lembrete fictício criado. Consulte Mensagens para processar o envio.",
            )
          }
        >
          Criar lembrete de teste
          <Plus size={16} />
        </button>
      </>
    );
  if (modal.type === "message") {
    const m = modal.value;
    return (
      <>
        <span className="modal-eyebrow">
          <MessageCircle size={17} />
          HISTÓRICO DO LEMBRETE
        </span>
        <h2 style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span className="patient-icon" aria-hidden="true">
            <User size={18} />
          </span>
          {m.patient}
        </h2>
        <p>
          {m.procedure} · {dateTime(m.appointment_at)}
        </p>
        <div className="modal-badges">
          <Badge value={m.state} />
          <Badge value={m.response_state} />
        </div>
        <div className="message-preview">
          <div>
            <MessageCircle size={15} />
            {m.template_name}
          </div>
          <p>{m.body || "Mensagem bloqueada por dados incompletos."}</p>
          <small>
            +{m.recipient} ·{" "}
            {m.synthetic
              ? "Agendamento fictício"
              : "Somente análise · origem Oracle"}
          </small>
        </div>
        <dl className="details-list">
          <div>
            <dt>Regra</dt>
            <dd>{m.rule_name}</dd>
          </div>
          <div>
            <dt>Previsto</dt>
            <dd>{dateTime(m.scheduled_for)}</dd>
          </div>
          <div>
            <dt>Tentativas</dt>
            <dd>{m.attempt_count}</dd>
          </div>
          <div>
            <dt>Código</dt>
            <dd>{m.error_code || "Sem erro registrado"}</dd>
          </div>
          <div>
            <dt>Canal</dt>
            <dd>{m.channel_id}</dd>
          </div>
        </dl>
        <details>
          <summary>Variáveis do template</summary>
          {m.parameters.map((value, index) => (
            <div className="parameter" key={index}>
              <code>{`{{${index + 1}}}`}</code>
              <span>{value}</span>
            </div>
          ))}
        </details>
        <details open={!!m.attempts.length}>
          <summary>Histórico de tentativas</summary>
          {m.attempts.map((attempt) => (
            <div className="attempt" key={attempt.id}>
              <Clock3 size={14} />
              <span>
                #{attempt.number} · {attempt.outcome}{" "}
                {attempt.error_code && `· ${attempt.error_code}`}
              </span>
              <small>{dateTime(attempt.started_at)}</small>
            </div>
          ))}
        </details>
        {canOperate && (
          <div className="modal-actions">
            {m.state === "queued" && m.synthetic && (
              <button
                className="button primary"
                disabled={busy || control.unit.paused}
                onClick={() =>
                  void mutate(
                    "tests/process",
                    { message_id: m.id },
                    "Envio de teste processado.",
                  )
                }
              >
                <Send size={15} />
                Processar envio de teste
              </button>
            )}
            {["failed", "blocked"].includes(m.state) && (
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void mutate(
                    `messages/${m.id}/retry`,
                    {},
                    "Mensagem reavaliada para nova tentativa.",
                  )
                }
              >
                Reprocessar individualmente
              </button>
            )}
            {m.provider_id &&
              m.channel_id === "simulated" &&
              control.mode === "simulated" && (
                <>
                  <p className="muted-note">Simular retorno do provedor:</p>
                  {[
                    ["delivered", "Entrega"],
                    ["read", "Leitura"],
                    ["confirmed", "Confirmação"],
                    ["declined", "Recusa"],
                    ["review", "Resposta livre"],
                  ].map(([event, label]) => (
                    <button
                      className="button"
                      disabled={busy}
                      key={event}
                      onClick={() =>
                        void mutate(
                          `messages/${m.id}/simulate`,
                          { event },
                          "Evento simulado registrado.",
                        )
                      }
                    >
                      {label}
                    </button>
                  ))}
                </>
              )}
          </div>
        )}
      </>
    );
  }
  if (modal.type === "issue") {
    const issue = modal.value;
    return (
      <>
        <span className="modal-eyebrow">
          <TriangleAlert size={17} />
          REVISÃO DA EQUIPE
        </span>
        <h2 style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span className="patient-icon" aria-hidden="true">
            <User size={18} />
          </span>
          {issue.patient}
        </h2>
        <p>{issue.description}</p>
        <div className="modal-note">
          <span>
            Código: <code>{issue.category}</code>
          </span>
        </div>
        {issue.reply_text && <blockquote>{issue.reply_text}</blockquote>}
        {canOperate ? (
          <>
            <label>
              Descrição da resolução
              <textarea
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="Descreva a verificação e a ação realizada…"
                rows={4}
              />
            </label>
            {issue.reply && !issue.message && (
              <label>
                Vincular a um lembrete
                <select
                  value={linkedMessage}
                  onChange={(e) => setLinkedMessage(e.target.value)}
                >
                  <option value="">Selecione um lembrete</option>
                  {candidates.map((m) => (
                    <option value={m.id} key={m.id}>
                      {m.patient} · {m.procedure} · +{m.recipient}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {candidateError && (
              <div className="inline-error">{candidateError}</div>
            )}
            <label>
              Classificação da resposta (opcional)
              <select
                value={classification}
                onChange={(e) => setClassification(e.target.value)}
              >
                <option value="">Manter situação atual</option>
                <option value="confirmed">Confirmado</option>
                <option value="declined">Recusado</option>
                <option value="review">Revisar</option>
              </select>
            </label>
            <button
              className="button primary"
              disabled={busy || resolution.trim().length < 5}
              onClick={() =>
                void mutate(
                  `issues/${issue.id}/resolve`,
                  {
                    resolution,
                    ...(classification ? { classification } : {}),
                    ...(linkedMessage ? { message_id: linkedMessage } : {}),
                  },
                  "Resolução registrada no histórico.",
                )
              }
            >
              Registrar resolução
              <Check size={16} />
            </button>
          </>
        ) : (
          <p className="muted-note">
            Seu perfil permite apenas consultar esta pendência.
          </p>
        )}
      </>
    );
  }
  if (modal.type === "rule" && ruleForm)
    return (
      <>
        <span className="modal-eyebrow">
          <Settings2 size={17} />
          REGRA DE LEMBRETE
        </span>
        <h2>{ruleForm.name}</h2>

        <label>
          Nome
          <input
            value={ruleForm.name}
            onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
          />
        </label>
        <div className="form-grid">
          <label>
            Dias de antecedência
            <input
              type="number"
              min={1}
              max={365}
              value={ruleForm.days_before}
              onChange={(e) =>
                setRuleForm({
                  ...ruleForm,
                  days_before: Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            Horário
            <input
              type="time"
              value={ruleForm.send_time.slice(0, 5)}
              onChange={(e) =>
                setRuleForm({ ...ruleForm, send_time: e.target.value })
              }
            />
          </label>
        </div>
        <label>Dias da semana</label>
        <div className="weekday-picker">
          {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map(
            (day, index) => (
              <button
                key={day}
                className={ruleForm.weekdays.includes(index) ? "selected" : ""}
                onClick={() =>
                  setRuleForm({
                    ...ruleForm,
                    weekdays: ruleForm.weekdays.includes(index)
                      ? ruleForm.weekdays.filter((d) => d !== index)
                      : [...ruleForm.weekdays, index],
                  })
                }
              >
                {day}
              </button>
            ),
          )}
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={ruleForm.enabled}
            onChange={(e) =>
              setRuleForm({ ...ruleForm, enabled: e.target.checked })
            }
          />
          Regra ativa
        </label>
        <button
          className="button primary"
          disabled={busy || !ruleForm.weekdays.length}
          onClick={() =>
            void mutate(
              `rules/${ruleForm.id}/configure`,
              {
                name: ruleForm.name,
                days_before: ruleForm.days_before,
                version: ruleForm.version,
                send_time: ruleForm.send_time,
                weekdays: ruleForm.weekdays,
                enabled: ruleForm.enabled,
              },
              "Nova versão da regra salva.",
            )
          }
        >
          Salvar nova versão
          <Check size={16} />
        </button>
      </>
    );
  if (modal.type === "template" && templateForm)
    return (
      <>
        <span className="modal-eyebrow">
          <MessageCircle size={17} />
          TEMPLATE E PARÂMETROS
        </span>
        <h2>{templateForm.name}</h2>

        <label>
          Nome na Meta
          <input
            disabled={role !== "admin"}
            value={templateForm.name}
            onChange={(e) =>
              setTemplateForm({ ...templateForm, name: e.target.value })
            }
          />
        </label>
        <label>
          Idioma
          <input
            disabled={role !== "admin"}
            value={templateForm.language}
            onChange={(e) =>
              setTemplateForm({ ...templateForm, language: e.target.value })
            }
          />
        </label>
        <label>
          Texto de referência
          <textarea
            disabled={role !== "admin"}
            rows={5}
            value={templateForm.body}
            onChange={(e) =>
              setTemplateForm({ ...templateForm, body: e.target.value })
            }
          />
        </label>
        <label>
          Mapa de variáveis, na ordem
          <input
            disabled={role !== "admin"}
            value={templateForm.fields.join(", ")}
            onChange={(e) =>
              setTemplateForm({
                ...templateForm,
                fields: e.target.value.split(",").map((v) => v.trim()),
              })
            }
          />
        </label>
        {role === "admin" && (
          <>
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void mutate(
                  `templates/${templateForm.id}/configure`,
                  {
                    name: templateForm.name,
                    language: templateForm.language,
                    body: templateForm.body,
                    fields: templateForm.fields,
                    version: templateForm.version,
                  },
                  "Template atualizado. A validação para testes foi desmarcada.",
                )
              }
            >
              Salvar conteúdo e mapa
            </button>
            <div className="modal-note">
              <ShieldCheck size={17} />
              <span>
                Validação local:{" "}
                {templateForm.approved_for_test ? "habilitada" : "pendente"}.
                Habilite somente após conferir o template aprovado no canal
                separado.
              </span>
            </div>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void mutate(
                  `templates/${templateForm.id}/configure`,
                  {
                    approved_for_test: !templateForm.approved_for_test,
                    version: templateForm.version,
                  },
                  "Validação local do template atualizada.",
                )
              }
            >
              {templateForm.approved_for_test
                ? "Desabilitar template"
                : "Marcar como validado para testes"}
            </button>
          </>
        )}
      </>
    );
  return null;
}
