import type {
  CanvasLayout,
  CanvasSource,
  CatalogSqlSource,
  SourceDialogState,
} from "../model";
import { IDENT_RE, clampBlockToPage, isParameterBinding, makeId } from "../model";

export function createSourceModalState(
  sources: CanvasSource[],
  availableSources: CatalogSqlSource[],
): { ok: true; state: SourceDialogState } | { ok: false; error: string } {
  if (sources.length >= 30) {
    return { ok: false, error: "Limite de 30 fontes por relatório." };
  }
  const existingIds = new Set(sources.map((s) => s.id));
  const defaultType = availableSources.length > 0 ? "report" : "inline";
  return {
    ok: true,
    state: {
      mode: "create",
      id: makeId(defaultType === "report" ? "dados" : "manual", existingIds),
      type: defaultType,
      reportId: availableSources[0] ? String(availableSources[0].id) : "",
      parametersJson: "{}",
      columnsJson: '["Mes", "Total"]',
      rowsJson: '[["Jan", 10], ["Fev", 20]]',
      error: "",
    },
  };
}

export function editSourceModalState(
  src: CanvasSource,
  availableSources: CatalogSqlSource[],
): SourceDialogState {
  return {
    mode: "edit",
    originalId: src.id,
    id: src.id,
    type: src.type,
    reportId:
      src.type === "report"
        ? String(src.report_id)
        : availableSources[0]
          ? String(availableSources[0].id)
          : "",
    dataset: src.type === "report" ? src.dataset : undefined,
    parametersJson: src.type === "report" ? JSON.stringify(src.parameters || {}, null, 2) : "{}",
    columnsJson: src.type === "inline" ? JSON.stringify(src.columns) : '["Mes", "Total"]',
    rowsJson:
      src.type === "inline" ? JSON.stringify(src.rows, null, 2) : '[["Jan", 10], ["Fev", 20]]',
    error: "",
  };
}

export function parseSourceModalState(
  sourceModal: SourceDialogState,
  existingSources: CanvasSource[],
  availableSources: CatalogSqlSource[],
): { ok: true; source: CanvasSource } | { ok: false; error: string } {
  const trimmedId = sourceModal.id.trim();
  if (!IDENT_RE.test(trimmedId)) {
    return {
      ok: false,
      error: "Identificador inválido. Use letras no início e apenas letras, números, _ ou -.",
    };
  }
  const duplicate = existingSources.some(
    (s) => s.id === trimmedId && s.id !== sourceModal.originalId,
  );
  if (duplicate) {
    return { ok: false, error: "Já existe uma fonte com este identificador." };
  }

  if (sourceModal.type === "report") {
    const rid = Number(sourceModal.reportId);
    if (!Number.isInteger(rid) || rid < 1) {
      return { ok: false, error: "Selecione uma fonte cadastrada." };
    }
    let parsedParams: Record<string, string | number | boolean | null | { parameter: string }> = {};
    if (sourceModal.parametersJson.trim()) {
      try {
        const raw = JSON.parse(sourceModal.parametersJson);
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          throw new Error("Parâmetros devem ser um objeto JSON.");
        }
        const entries = Object.entries(raw);
        if (entries.length > 30) throw new Error("Máximo de 30 parâmetros na fonte.");
        for (const [k, v] of entries) {
          if (!k || k.length > 50) throw new Error("Chave de parâmetro inválida.");
          if (
            v !== null &&
            typeof v !== "string" &&
            typeof v !== "number" &&
            typeof v !== "boolean" &&
            !isParameterBinding(v)
          ) {
            throw new Error(
              `Valor inválido no parâmetro "${k}". Use texto, número, booleano ou null.`,
            );
          }
        }
        parsedParams = raw as Record<
          string,
          string | number | boolean | null | { parameter: string }
        >;
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }
    const catalog = availableSources.find((s) => s.id === rid);
    const dataset = sourceModal.dataset || catalog?.datasets?.[0]?.id;
    return {
      ok: true,
      source: {
        id: trimmedId,
        type: "report",
        report_id: rid,
        parameters: parsedParams,
        ...(dataset ? { dataset } : {}),
      },
    };
  }

  if (sourceModal.type === "inline") {
    let cols: string[];
    let rows: Array<Array<string | number | boolean | null>>;
    try {
      const parsedCols = JSON.parse(sourceModal.columnsJson);
      if (
        !Array.isArray(parsedCols) ||
        parsedCols.length < 1 ||
        parsedCols.length > 100 ||
        parsedCols.some((c) => typeof c !== "string" || !c.trim() || c.length > 100)
      ) {
        throw new Error("Colunas devem ser uma lista JSON de nomes não vazios.");
      }
      cols = parsedCols.map((c: string) => c.trim());
      if (new Set(cols).size !== cols.length) {
        throw new Error("Os nomes das colunas não podem se repetir.");
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof SyntaxError ? "JSON de colunas inválido." : (err as Error).message,
      };
    }
    try {
      const parsedRows = JSON.parse(sourceModal.rowsJson);
      if (!Array.isArray(parsedRows) || parsedRows.length > 2000) {
        throw new Error("Linhas devem ser uma lista JSON (até 2000 linhas).");
      }
      for (let i = 0; i < parsedRows.length; i++) {
        const r = parsedRows[i];
        if (!Array.isArray(r) || r.length !== cols.length) {
          throw new Error(`A linha ${i + 1} deve ter exatamente ${cols.length} valores.`);
        }
        for (const cell of r) {
          if (
            cell !== null &&
            typeof cell !== "string" &&
            typeof cell !== "number" &&
            typeof cell !== "boolean"
          ) {
            throw new Error(`Valor inválido na linha ${i + 1}.`);
          }
        }
      }
      rows = parsedRows;
    } catch (err) {
      return {
        ok: false,
        error: err instanceof SyntaxError ? "JSON de linhas inválido." : (err as Error).message,
      };
    }
    return { ok: true, source: { id: trimmedId, type: "inline", columns: cols, rows } };
  }

  return { ok: true, source: { id: trimmedId, type: "goals" } };
}

export function applySavedSourceToLayout(
  prev: CanvasLayout,
  modal: SourceDialogState,
  nextSource: CanvasSource,
  autoBindBlock?: { pageId: string; blockId: string } | null,
): CanvasLayout {
  const updatedSources =
    modal.mode === "edit"
      ? prev.sources.map((s) => (s.id === modal.originalId ? nextSource : s))
      : [...prev.sources, nextSource];
  const renamedFrom =
    modal.mode === "edit" && modal.originalId !== nextSource.id ? modal.originalId : null;

  let updatedPages = renamedFrom
    ? prev.pages.map((p) => ({
        ...p,
        blocks: p.blocks.map((b) =>
          b.source_id === renamedFrom ? { ...b, source_id: nextSource.id } : b,
        ),
      }))
    : prev.pages;

  if (autoBindBlock) {
    updatedPages = updatedPages.map((p) =>
      p.id !== autoBindBlock.pageId
        ? p
        : {
            ...p,
            blocks: p.blocks.map((b) =>
              b.id === autoBindBlock.blockId
                ? clampBlockToPage({ ...b, source_id: nextSource.id }, prev.page.width, prev.page.height)
                : b,
            ),
          },
    );
  }

  return { ...prev, sources: updatedSources, pages: updatedPages };
}

export function applyRemovedSourceToLayout(prev: CanvasLayout, sourceId: string): CanvasLayout {
  return {
    ...prev,
    sources: prev.sources.filter((s) => s.id !== sourceId),
    pages: prev.pages.map((p) => ({
      ...p,
      blocks: p.blocks.map((b) =>
        b.source_id === sourceId ? { ...b, source_id: undefined } : b,
      ),
    })),
  };
}
