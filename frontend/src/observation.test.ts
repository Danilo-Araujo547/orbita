import { describe, expect, it } from "vitest";

function cleanNoteText(text: string): string {
  return text.replace(/^\[(Caso resolvido|Resolvido)\]\s*/i, "");
}

function isNoteResolved(text: string): boolean {
  return /^\[(Caso resolvido|Resolvido)\]/i.test(text);
}

describe("Observation resolution and interlocutor helpers", () => {
  it("detects resolved notes properly", () => {
    expect(isNoteResolved("[Caso resolvido] Paciente contatado por telefone.")).toBe(true);
    expect(isNoteResolved("[Resolvido] Tudo certo.")).toBe(true);
    expect(isNoteResolved("Observação comum sem resolução.")).toBe(false);
  });

  it("cleans note text prefix for display", () => {
    expect(
      cleanNoteText("[Caso resolvido] Paciente confirmou presença."),
    ).toBe("Paciente confirmou presença.");
    expect(
      cleanNoteText("[Resolvido] Confirmado."),
    ).toBe("Confirmado.");
    expect(
      cleanNoteText("Observação normal mantida intacta."),
    ).toBe("Observação normal mantida intacta.");
  });

  it("handles empty or regular text without crashing", () => {
    expect(cleanNoteText("")).toBe("");
    expect(isNoteResolved("")).toBe(false);
  });
});
