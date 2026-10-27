import { useMemo, useState } from "react";
import { Copy, Check, RefreshCw, X, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import type { CanvasSource, SourcePreview } from "../model";
import ColumnBadge from "./ColumnBadge";
import { formatCellValue } from "./columnTypes";

export interface DataDrawerProps {
  source: CanvasSource | null;
  preview: SourcePreview | null;
  loading?: boolean;
  onClose: () => void;
  onRefresh?: () => void;
}

export default function DataDrawer({
  source,
  preview,
  loading = false,
  onClose,
  onRefresh,
}: DataDrawerProps) {
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [copied, setCopied] = useState(false);

  if (!source) return null;

  const columns: import("../model").ColumnInfo[] =
    preview?.columns ||
    (source.type === "inline"
      ? source.columns.map((c) => ({
          name: c,
          type: "unknown" as const,
          nullable: true,
          null_count: 0,
        }))
      : []);
  const rawRows = preview?.rows || (source.type === "inline" ? source.rows : []);

  // Filter rows locally
  const filteredRows = useMemo(() => {
    if (!search.trim()) return rawRows;
    const term = search.toLowerCase().trim();
    return rawRows.filter((row) =>
      row.some((cell) => cell !== null && cell !== undefined && String(cell).toLowerCase().includes(term)),
    );
  }, [rawRows, search]);

  // Sort rows locally
  const sortedRows = useMemo(() => {
    if (sortCol === null || sortCol >= columns.length) return filteredRows;
    const colType = columns[sortCol]?.type;
    return [...filteredRows].sort((a, b) => {
      const valA = a[sortCol];
      const valB = b[sortCol];
      if (valA === valB) return 0;
      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      if (colType === "number" || (typeof valA === "number" && typeof valB === "number")) {
        const numA = Number(valA);
        const numB = Number(valB);
        return sortDir === "asc" ? numA - numB : numB - numA;
      }

      const strA = String(valA).toLowerCase();
      const strB = String(valB).toLowerCase();
      const comp = strA.localeCompare(strB, "pt-BR");
      return sortDir === "asc" ? comp : -comp;
    });
  }, [columns, filteredRows, sortCol, sortDir]);

  const displayRows = sortedRows.slice(0, 50);

  const toggleSort = (colIdx: number) => {
    if (sortCol === colIdx) {
      if (sortDir === "asc") setSortDir("desc");
      else setSortCol(null);
    } else {
      setSortCol(colIdx);
      setSortDir("asc");
    }
  };

  const handleCopyTsv = async () => {
    if (!columns.length) return;
    const headerLine = columns.map((c) => c.name).join("\t");
    const rowLines = displayRows.map((r) =>
      r.map((cell) => (cell === null || cell === undefined ? "" : String(cell))).join("\t"),
    );
    const tsv = [headerLine, ...rowLines].join("\n");
    try {
      await navigator.clipboard.writeText(tsv);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const totalCount = preview?.total_rows ?? rawRows.length;
  const countText = `${displayRows.length} de ${totalCount.toLocaleString("pt-BR")} linhas`;

  return (
    <div className="cv-data-drawer cv-root" role="dialog" aria-label={`Dados da fonte ${source.label || source.id}`}>
      <div className="cv-drawer-head">
        <div className="cv-drawer-title-group">
          <h3 className="cv-drawer-title">
            Dados: {source.label || source.id}
          </h3>
          <span className="cv-drawer-count">{countText}</span>
          {loading && <span className="cv-chip loading">Atualizando…</span>}
        </div>
        <div className="cv-drawer-controls">
          <input
            type="search"
            className="cv-search-input"
            placeholder="Buscar nas linhas…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar nas linhas da prévia"
          />
          <button
            type="button"
            className="cv-btn-compact"
            onClick={handleCopyTsv}
            title="Copiar dados exibidos como TSV"
          >
            {copied ? <Check size={12} color="var(--cv-success)" /> : <Copy size={12} />}
            {copied ? "Copiado!" : "Copiar TSV"}
          </button>
          {onRefresh && (
            <button
              type="button"
              className="cv-icon-btn"
              onClick={onRefresh}
              title="Atualizar prévia da fonte"
              disabled={loading}
              aria-label="Atualizar prévia"
            >
              <RefreshCw size={13} className={loading ? "spin" : ""} />
            </button>
          )}
          <button
            type="button"
            className="cv-icon-btn"
            onClick={onClose}
            title="Fechar gaveta de dados"
            aria-label="Fechar"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="cv-drawer-body">
        {columns.length === 0 ? (
          <div className="cv-data-empty">Nenhuma coluna nesta fonte.</div>
        ) : (
          <table className="cv-preview-table">
            <thead>
              <tr>
                <th style={{ width: 36, textAlign: "center" }}>#</th>
                {columns.map((col, idx) => (
                  <th key={col.name || idx} onClick={() => toggleSort(idx)} title={`Ordenar por ${col.name}`}>
                    <div className="cv-table-th-content">
                      <ColumnBadge type={col.type} looksLike={col.looks_like} />
                      <span>{col.name}</span>
                      {col.null_count !== undefined && (
                        <span className="cv-table-null-count" title={`${col.null_count} valores nulos`}>
                          ({col.null_count} nulos)
                        </span>
                      )}
                      {sortCol === idx ? (
                        sortDir === "asc" ? (
                          <ArrowUp size={11} />
                        ) : (
                          <ArrowDown size={11} />
                        )
                      ) : (
                        <ArrowUpDown size={10} style={{ opacity: 0.3 }} />
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 1} style={{ textAlign: "center", padding: "24px" }}>
                    Nenhum registro encontrado.
                  </td>
                </tr>
              ) : (
                displayRows.map((row, rIdx) => (
                  <tr key={rIdx}>
                    <td style={{ textAlign: "center", color: "var(--cv-text-disabled)" }}>{rIdx + 1}</td>
                    {columns.map((col, cIdx) => {
                      const cellVal = row[cIdx];
                      const isNull = cellVal === null || cellVal === undefined;
                      const formatted = formatCellValue(cellVal, col.type);
                      const isNum = col.type === "number" || typeof cellVal === "number";

                      return (
                        <td
                          key={cIdx}
                          className={`${isNum ? "cell-number" : ""} ${isNull ? "cell-null" : ""}`}
                        >
                          {formatted}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
