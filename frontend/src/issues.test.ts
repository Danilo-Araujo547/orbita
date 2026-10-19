import { describe, expect, it } from "vitest";
import { isAppointmentIssue } from "./components/OperationalAppointments";
import type { Appointment } from "./types";

function mockAppointment(partial: Partial<Appointment>): Appointment {
  return {
    id: 1,
    external_id: "APT-1",
    kind: "consultation",
    patient: "Paciente Teste",
    phone: "11999999999",
    procedure: "Consulta Geral",
    scheduled_at: "2026-10-15T10:00:00Z",
    arrival_time: "09:45",
    synthetic: false,
    source: "system",
    revision: 1,
    ...partial,
  };
}

describe("isAppointmentIssue", () => {
  it("exclui confirmado quando outro contato recusou e a mensagem foi entregue", () => {
    const item = mockAppointment({
      tracking: {
        id: "case-confirmed",
        version: 1,
        outcome: "confirmed",
        response: "answered",
        corrections: 1,
        observations: 0,
        messages: 2,
        contacts: [
          {
            phone: "5511999900010",
            delivery: "delivered",
            response: "confirmed",
          },
          {
            phone: "5511999900011",
            delivery: "delivered",
            response: "declined",
          },
        ],
      },
    });
    expect(isAppointmentIssue(item)).toBe(false);
  });

  it("exclui quem aguarda resposta após entrega", () => {
    const item = mockAppointment({
      tracking: {
        id: "case-waiting",
        version: 1,
        outcome: "",
        response: "pending",
        corrections: 0,
        observations: 0,
        messages: 1,
        contacts: [
          {
            phone: "5511999900030",
            delivery: "delivered",
            response: "pending",
          },
        ],
      },
    });
    expect(isAppointmentIssue(item)).toBe(false);
  });
  it("identifica agendamento que respondeu não (outcome declined)", () => {
    const item = mockAppointment({
      tracking: {
        id: "case-1",
        version: 1,
        outcome: "declined",
        response: "declined",
        corrections: 0,
        observations: 0,
        messages: 1,
        contacts: [
          { phone: "11999999999", delivery: "delivered", response: "declined" },
        ],
      },
    });
    expect(isAppointmentIssue(item)).toBe(true);
  });

  it("identifica agendamento com número inválido nos contatos", () => {
    const item = mockAppointment({
      tracking: {
        id: "case-2",
        version: 1,
        outcome: "pending",
        response: "pending",
        corrections: 0,
        observations: 0,
        messages: 1,
        contacts: [
          {
            phone: "11000000000",
            delivery: "failed",
            response: "pending",
            status: "invalid",
          },
        ],
      },
    });
    expect(isAppointmentIssue(item)).toBe(true);
  });

  it("identifica agendamento com falha de entrega ou bloqueio", () => {
    const item = mockAppointment({
      tracking: {
        id: "case-3",
        version: 1,
        outcome: "pending",
        response: "pending",
        corrections: 0,
        observations: 0,
        messages: 1,
        contacts: [
          {
            phone: "11988888888",
            delivery: "failed",
            response: "pending",
          },
        ],
      },
    });
    expect(isAppointmentIssue(item)).toBe(true);
  });

  it("identifica agendamento marcado para revisão ou com correções abertas", () => {
    const itemReview = mockAppointment({
      tracking: {
        id: "case-4",
        version: 1,
        outcome: "review",
        response: "review",
        corrections: 0,
        observations: 0,
        messages: 1,
        contacts: [],
      },
    });
    const itemCorrections = mockAppointment({
      tracking: {
        id: "case-5",
        version: 1,
        outcome: "pending",
        response: "pending",
        corrections: 2,
        observations: 0,
        messages: 1,
        contacts: [],
      },
    });
    expect(isAppointmentIssue(itemReview)).toBe(true);
    expect(isAppointmentIssue(itemCorrections)).toBe(true);
  });

  it("identifica agendamento em que contato não conhece o paciente ou fez opt-out", () => {
    const itemOptOut = mockAppointment({
      tracking: {
        id: "case-6",
        version: 1,
        outcome: "pending",
        response: "pending",
        corrections: 0,
        observations: 0,
        messages: 1,
        contacts: [
          {
            phone: "11977777777",
            delivery: "delivered",
            response: "opt_out",
            opted_out: true,
          },
        ],
      },
    });
    expect(isAppointmentIssue(itemOptOut)).toBe(true);
  });

  it("não marca como pendência agendamento confirmado sem falhas", () => {
    const itemConfirmed = mockAppointment({
      tracking: {
        id: "case-7",
        version: 1,
        outcome: "confirmed",
        response: "confirmed",
        corrections: 0,
        observations: 0,
        messages: 1,
        contacts: [
          {
            phone: "11966666666",
            delivery: "delivered",
            response: "confirmed",
          },
        ],
      },
    });
    expect(isAppointmentIssue(itemConfirmed)).toBe(false);
  });

  it("não marca como pendência agendamento aguardando envio normal", () => {
    const itemPending = mockAppointment({
      tracking: {
        id: "case-8",
        version: 1,
        outcome: "pending",
        response: "pending",
        corrections: 0,
        observations: 0,
        messages: 0,
        contacts: [
          {
            phone: "11955555555",
            delivery: "queued",
            response: "pending",
          },
        ],
      },
    });
    expect(isAppointmentIssue(itemPending)).toBe(false);
  });
});

it("mantém pós-cirúrgico que requer atendimento na lista de pendências", () => {
  const item = mockAppointment({kind: "postoperative", record_type: "cross", tracking: {id: "postoperative-case", version: 1, outcome: "needs_attention", response: "answered", corrections: 0, observations: 0, messages: 1, contacts: []}});
  expect(isAppointmentIssue(item)).toBe(true);
});
