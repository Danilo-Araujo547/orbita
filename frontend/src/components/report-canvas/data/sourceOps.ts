import type {
  CanvasLayout,
  CanvasSource,
  CatalogSqlSource,
  SourceDialogState,
} from "../model";
import { IDENT_RE, clampBlockToPage, isParameterBinding, makeId } from "../model";

export interface SourceUsage {
  pageId: string;
  pageName: string;
  blockId: string;
  blockTitle: string;
  blockType: string;
}

export function slugifySourceName(name: string): string {
  const clean = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const validStart = /^[a-z]/i.test(clean) ? clean : `src_${clean}`;
  return validStart.slice(0, 45);
}

export function validateSourceId(
  id: string,
  existingSources: CanvasSource[],
  originalId?: string,
): { ok: true } | { ok: false; error: string } {
  const trimmed = id.trim();
  if (!trimmed) {
    return { ok: false, error: "Identificador não pode ser vazio." };
  }
  if (!IDENT_RE.test(trimmed)) {
    return {
      ok: false,
      error: "Identificador inválido. Comece com letra e use apenas letras, números, _ ou -.",
    };
  }
  const duplicate = existingSources.some(
    (s) => s.id === trimmed && s.id !== originalId,
  );
  if (duplicate) {
    return { ok: false, error: "Já existe uma fonte com este identificador." };
  }
  return { ok: true };
}

export function findSourceUsages(layout: CanvasLayout, sourceId: string): SourceUsage[] {
  const usages: SourceUsage[] = [];
  for (const page of layout.pages) {
    for (const block of page.blocks) {
      if (block.source_id === sourceId) {
        usages.push({
          pageId: page.id,
          pageName: page.name,
          blockId: block.id,
          blockTitle: block.title || `Bloco ${block.id}`,
          blockType: block.type,
        });
      }
    }
  }
  return usages;
}

export function parseDelimitedLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === delimiter && !insideQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

export function parsePastedTable(text: string): {
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
} {
  const clean = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!clean) {
    return { columns: ["coluna_1"], rows: [] };
  }

  const rawLines = clean.split("\n").filter((l) => l.trim().length > 0);
  if (!rawLines.length) {
    return { columns: ["coluna_1"], rows: [] };
  }

  if (rawLines.length - 1 > 2000) {
    throw new Error("A tabela manual aceita até 2.000 linhas. Reduza a seleção e cole novamente.");
  }

  // Detect delimiter using first line
  const firstLine = rawLines[0];
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;

  let delimiter = "\t";
  if (tabCount > 0) {
    delimiter = "\t";
  } else if (semiCount >= commaCount && semiCount > 0) {
    delimiter = ";";
  } else if (commaCount > 0) {
    delimiter = ",";
  }

  // Parse header
  const rawHeaders = parseDelimitedLine(firstLine, delimiter);
  if (rawHeaders.length > 100) {
    throw new Error("A tabela manual aceita até 100 colunas. Reduza a seleção e cole novamente.");
  }
  const seenHeaders = new Set<string>();
  const columns: string[] = rawHeaders.slice(0, 100).map((h, idx) => {
    let name = h.trim() || `coluna_${idx + 1}`;
    name = name.slice(0, 100);
    let candidate = name;
    let n = 2;
    while (seenHeaders.has(candidate)) {
      const suffix = `_${n++}`;
      candidate = `${name.slice(0, 100 - suffix.length)}${suffix}`;
    }
    seenHeaders.add(candidate);
    return candidate;
  });

  if (columns.length === 0) {
    columns.push("coluna_1");
  }

  const colCount = columns.length;
  const rows: Array<Array<string | number | boolean | null>> = [];

  for (let i = 1; i < rawLines.length && rows.length < 2000; i++) {
    const rawCells = parseDelimitedLine(rawLines[i], delimiter);
    const row: Array<string | number | boolean | null> = [];

    for (let j = 0; j < colCount; j++) {
      const cell = rawCells[j] !== undefined ? rawCells[j] : "";
      if (cell === "" || cell.toLowerCase() === "null") {
        row.push(null);
      } else if (cell.toLowerCase() === "true") {
        row.push(true);
      } else if (cell.toLowerCase() === "false") {
        row.push(false);
      } else {
        // Try parsing number
        const normalizedNum =
          delimiter !== "," && /^-?\d+,\d+$/.test(cell)
            ? cell.replace(",", ".")
            : cell;
        const num = Number(normalizedNum);
        if (Number.isFinite(num) && !/^\s*0\d+/.test(cell)) {
          row.push(num);
        } else {
          row.push(cell);
        }
      }
    }
    rows.push(row);
  }

  return { columns, rows };
}

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
      label: "",
      type: defaultType,
      reportId: availableSources[0] ? String(availableSources[0].id) : "",
      parametersJson: "{}",
      columnsJson: '["Mes", "Total"]',
      rowsJson: '[["Jan", 10], ["Fev", 20]]',
      error: "",
      testPreview: null,
      testError: null,
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
    label: src.label || "",
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
    testPreview: null,
    testError: null,
  };
}

export function parseSourceModalState(
  sourceModal: SourceDialogState,
  existingSources: CanvasSource[],
  availableSources: CatalogSqlSource[],
): { ok: true; source: CanvasSource } | { ok: false; error: string } {
  const trimmedId = sourceModal.id.trim();
  const idValidation = validateSourceId(trimmedId, existingSources, sourceModal.originalId);
  if (!idValidation.ok) {
    return idValidation;
  }

  const labelProp =
    sourceModal.label && sourceModal.label.trim()
      ? { label: sourceModal.label.trim().slice(0, 60) }
      : {};

  if (sourceModal.type === "report") {
    const rid = Number(sourceModal.reportId);
    if (!Number.isInteger(rid) || rid < 1) {
      return { ok: false, error: "Selecione uma fonte cadastrada." };
    }
    let parsedParams: Record<string, string | number | boolean | null | { parameter: string }> = {};
    if (sourceModal.parametersJson && sourceModal.parametersJson.trim()) {
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
        ...labelProp,
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
      cols = parsedCols.map((c: string) => c.trim().slice(0, 60));
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
    return {
      ok: true,
      source: {
        id: trimmedId,
        type: "inline",
        ...labelProp,
        columns: cols,
        rows,
      },
    };
  }

  return {
    ok: true,
    source: {
      id: trimmedId,
      type: "goals",
      ...labelProp,
    },
  };
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
                ? clampBlockToPage(
                    { ...b, source_id: nextSource.id },
                    prev.page.width,
                    prev.page.height,
                  )
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
