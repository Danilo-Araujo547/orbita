import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearSourcePreviewCache,
  fetchSourcePreviewRequest,
  findMissingRequiredParameter,
  getCachedSourcePreview,
  hashSourceSpec,
  isUnavailableStatus,
  setCachedSourcePreview,
} from "./components/report-canvas/api/useSourcePreview";
import type { CanvasSource, SourcePreview } from "./components/report-canvas/model";

afterEach(() => {
  clearSourcePreviewCache();
  vi.unstubAllGlobals();
});

describe("Hash e Cache de especificação de fonte (useSourcePreview)", () => {
  const source: CanvasSource = {
    id: "vendas",
    type: "report",
    report_id: 10,
    parameters: { ano: 2026 },
  };

  it("gera hash determinístico independente da ordem das chaves de parâmetros", () => {
    const hash1 = hashSourceSpec(source, { inicio: "2026-01-01", fim: "2026-12-31" }, 50);
    const hash2 = hashSourceSpec(source, { fim: "2026-12-31", inicio: "2026-01-01" }, 50);
    expect(hash1).toBe(hash2);
  });

  it("armazena e recupera prévia no cache em memória", () => {
    const previewData: SourcePreview = {
      columns: [{ name: "total", type: "number", null_count: 0 }],
      rows: [[100], [200]],
      total_rows: 2,
      truncated: false,
      loaded_at: "2026-10-27T10:00:00Z",
    };

    expect(getCachedSourcePreview(source)).toBeUndefined();
    setCachedSourcePreview(source, previewData);
    expect(getCachedSourcePreview(source)).toEqual(previewData);

    clearSourcePreviewCache();
    expect(getCachedSourcePreview(source)).toBeUndefined();
  });
});

describe("Validação de parâmetros obrigatórios antes da requisição", () => {
  const schema = {
    data_inicial: { label: "Data inicial", required: true },
    data_final: { label: "Data final", required: true },
    setor: { label: "Setor", required: false, default: "Geral" },
  };

  it("detecta parâmetro obrigatório sem valor informado", () => {
    const missing1 = findMissingRequiredParameter(schema, {});
    expect(missing1).toEqual({ name: "data_inicial", label: "Data inicial" });

    const missing2 = findMissingRequiredParameter(schema, { data_inicial: "2026-01-01" });
    expect(missing2).toEqual({ name: "data_final", label: "Data final" });
  });

  it("aceita parâmetros preenchidos ou com vinculação de parâmetro", () => {
    const valid = findMissingRequiredParameter(schema, {
      data_inicial: "2026-01-01",
      data_final: "2026-12-31",
    });
    expect(valid).toBeNull();

    const bound = findMissingRequiredParameter(schema, {
      data_inicial: { parameter: "data_ini" },
      data_final: { parameter: "data_fim" },
    });
    expect(bound).toBeNull();
  });
});

describe("Detecção de degradação e erros de servidor (isUnavailableStatus)", () => {
  it("reconhece status HTTP 404 e 405 como indisponibilidade de versão", () => {
    expect(isUnavailableStatus(404)).toBe(true);
    expect(isUnavailableStatus(405)).toBe(true);
    expect(isUnavailableStatus(200)).toBe(false);
    expect(isUnavailableStatus(500)).toBe(false);
  });

  it("detecta mensagens de recurso não encontrado ou indisponível", () => {
    expect(
      isUnavailableStatus(undefined, "O servidor retornou uma resposta inválida (HTTP 404). Tente novamente."),
    ).toBe(true);
    expect(
      isUnavailableStatus(undefined, "Prévia de dados indisponível nesta versão do servidor"),
    ).toBe(true);
    expect(isUnavailableStatus(undefined, "Coluna não encontrada")).toBe(false);
  });
});

describe("Requisição de prévia (fetchSourcePreviewRequest)", () => {
  const source: CanvasSource = {
    id: "faturamento",
    type: "report",
    report_id: 12,
  };

  it("converte resposta da API para estrutura SourcePreview normalizada", async () => {
    const mockApiResponse = {
      columns: [
        { name: "mes", type: "text", looks_like: "date", nullable: false, null_count: 0, sample: ["jan", "fev"] },
        { name: "total", type: "number", nullable: true, null_count: 1, sample: ["1500.5"] },
      ],
      rows: [["jan", 1500.5], ["fev", null]],
      total_rows: 2,
      truncated: false,
      elapsed_ms: 22,
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockApiResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const preview = await fetchSourcePreviewRequest(12, "teste", source);
    expect(preview.columns).toHaveLength(2);
    expect(preview.columns[0].name).toBe("mes");
    expect(preview.columns[0].looks_like).toBe("date");
    expect(preview.columns[1].null_count).toBe(1);
    expect(preview.rows).toHaveLength(2);
    expect(preview.total_rows).toBe(2);
    expect(preview.elapsed_ms).toBe(22);
    expect(preview.loaded_at).toBeDefined();
  });

  it("cancela requisição quando o AbortSignal é disparado", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchSourcePreviewRequest(12, "teste", source, {}, 50, controller.signal),
    ).rejects.toThrow();
  });
});
