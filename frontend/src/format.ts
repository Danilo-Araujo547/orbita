export const kinds: Record<string, string> = {
  consultation: "Consulta",
  exam: "Exame",
  lab: "Laboratório",
  waitlist: "Fila CDR",
  postoperative: "Pós-cirúrgico",
};
export const labels: Record<string, string> = {
  not_requested: "Sem envio confirmado",
  delivered_or_read: "Entregues e lidas",
  preview: "Somente análise",
  queued: "Na fila",
  sending: "Enviando",
  accepted: "Aceita pela API",
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
  failed: "Falha",
  uncertain: "Resultado incerto",
  blocked: "Bloqueada",
  expired: "Vencida",
  cancelled: "Invalidada",
  pending: "Aguardando",
  confirmed: "Confirmado",
  declined: "Recusado",
  no_response: "Sem resposta",
  review: "Revisar",
  completed: "Concluída",
  running: "Em andamento",
  wrong_person: "Não conhece o paciente",
  opt_out: "Não deseja receber mensagens",
  stay_waitlist: "Permanece na fila",
  leave_waitlist: "Saiu da fila",
  well: "Informou estar bem",
  needs_attention: "Requer atendimento",
  acknowledged: "Ciente",
  reason_received: "Motivo informado",
};
export const dateTime = (date: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
export const dateOnly = (date: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "short",
  }).format(new Date(date));
export function percentage(value: number, total: number) {
  return total ? Math.round((value / total) * 100) : 0;
}
