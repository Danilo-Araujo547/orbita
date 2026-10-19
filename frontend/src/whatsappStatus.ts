import type { Appointment } from "./types";

export type WhatsAppState = "not_sent" | "sent" | "confirmed" | "declined" | "error";
const sentStates = new Set(["accepted", "sent", "delivered", "read"]);
const failureStates = new Set(["failed", "blocked", "uncertain"]);
export function whatsappStatus(item: Appointment): { state: WhatsAppState; label: string } {
  const tracking = item.tracking;
  const contacts = tracking?.contacts || [];
  const sent = contacts.some(contact => sentStates.has(contact.delivery));
  const hasError = contacts.some(contact => failureStates.has(contact.delivery) || ["invalid", "wrong_person"].includes(contact.status || "") || contact.opted_out);
  if (!sent) return hasError
    ? {state: "error", label: "WhatsApp: erro no envio ou contato inválido"}
    : {state: "not_sent", label: "WhatsApp: envio não executado"};
  const outcomes = [tracking?.outcome, tracking?.response, ...contacts.map(contact => contact.response)];
  if (outcomes.includes("confirmed")) return {state: "confirmed", label: "WhatsApp: enviada e confirmada"};
  if (outcomes.includes("declined")) return {state: "declined", label: "WhatsApp: enviada e recusada"};
  if (hasError)
    return {state: "error", label: "WhatsApp: erro em um dos contatos"};
  return {state: "sent", label: "WhatsApp: enviada, aguardando resposta"};
}
