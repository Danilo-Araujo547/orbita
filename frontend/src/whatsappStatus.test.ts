import { describe, expect, it } from "vitest";
import type { Appointment } from "./types";
import { whatsappStatus } from "./whatsappStatus";
function appointment(deliveries: string[], responses: string[] = [], outcome = ""): Appointment {
  return { id: 1, tracking: {id: "case", version: 1, outcome, response: "pending", corrections: 0, observations: 0, messages: deliveries.length, contacts: deliveries.map((delivery, index) => ({phone: String(index), delivery, response: responses[index] || "pending"}))}} as Appointment;
}
describe("WhatsApp appointment indicator", () => {
  it("keeps messages neutral before sending", () => {
    expect(whatsappStatus(appointment([])).state).toBe("not_sent");
    for (const state of ["queued", "preview", "not_queued", "cancelled", "expired"]) expect(whatsappStatus(appointment([state])).state).toBe("not_sent");
  });
  it("shows accepted, sent, delivered and read messages in green", () => {
    for (const state of ["accepted", "sent", "delivered", "read"]) expect(whatsappStatus(appointment([state])).state).toBe("sent");
  });
  it("shows a confirmed response in blue", () => {
    expect(whatsappStatus(appointment(["delivered"], ["confirmed"])).state).toBe("confirmed");
  });
  it("shows a refusal in purple", () => {
    expect(whatsappStatus(appointment(["delivered"], ["declined"])).state).toBe("declined");
  });
  it("keeps the patient confirmed when another number refuses or fails", () => {
    expect(whatsappStatus(appointment(["read", "failed"], ["confirmed", "declined"], "declined")).state).toBe("confirmed");
  });
  it("shows transport problems in red", () => {
    for (const state of ["failed", "blocked", "uncertain"]) expect(whatsappStatus(appointment([state])).state).toBe("error");
    expect(whatsappStatus(appointment(["sent", "failed"])).state).toBe("error");
  });
  it("does not label an unsent message as sent after a manual confirmation", () => {
    expect(whatsappStatus(appointment(["queued"], ["confirmed"], "confirmed")).state).toBe("not_sent");
  });
});

it("keeps an invalid number red even without sending", () => {
  const item = appointment(["not_queued"]);
  item.tracking!.contacts[0].status = "invalid";
  expect(whatsappStatus(item).state).toBe("error");
});
it("shows an API rejection in red", () => {
  expect(whatsappStatus(appointment(["failed"])).state).toBe("error");
});
