import { describe, expect, it } from "vitest";
import {
  parameterCount,
  standardFields,
  suggestedParameters,
} from "./components/CrossImportConfiguration";
describe("Contrato padronizado Importa CROSS", () => {
  it("mantém os 12 campos na ordem acordada", () => {
    expect([...standardFields]).toEqual([
      "nome_completo",
      "data",
      "hora",
      "celular",
      "celular2",
      "tipo",
      "horario_chegada",
      "data_nascimento",
      "codigo",
      "local",
      "tipo2",
      "obs",
    ]);
  });
  it("usa a quantidade de posições do template, mesmo quando repetidas", () => {
    expect(
      parameterCount({ id: 1, body: "{{1}} {{2}} {{1}}", fields: [] }),
    ).toBe(2);
  });
  it("preserva o significado de campos legados nas sugestões", () => {
    expect(
      suggestedParameters({
        id: 1,
        body: "{{1}} {{2}}",
        fields: ["patient", "procedure"],
      }),
    ).toEqual(["nome_completo", "tipo"]);
  });
  it("sugere o padrão para templates novos sem mapeamento", () => {
    expect(
      suggestedParameters({ id: 1, body: "{{1}} {{2}} {{3}}", fields: [] }),
    ).toEqual(["nome_completo", "data", "hora"]);
  });
  it("não cria parâmetros para template sem variáveis", () => {
    expect(
      suggestedParameters({ id: 1, body: "Texto fixo", fields: [] }),
    ).toEqual([]);
  });
});
