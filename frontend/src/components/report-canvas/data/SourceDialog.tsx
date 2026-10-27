import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, FormEvent } from "react";
import {
  AlertCircle,
  Check,
  Database,
  Plus,
  RefreshCw,
  Search,
  Table,
  Target,
  Trash2,
  Upload,
} from "lucide-react";
import InlineDialog from "../../InlineDialog";
import Select from "../../Select";
import { fetchSourcePreviewRequest } from "../api/useSourcePreview";
import type {
  CanvasSource,
  CatalogSqlSource,
  SourceDialogState,
} from "../model";
import { isParameterBinding } from "../model";
import ColumnBadge from "./ColumnBadge";
import { inferColumnType } from "./columnTypes";
import {
  parsePastedTable,
  slugifySourceName,
  validateSourceId,
} from "./sourceOps";

export interface SourceDialogProps {
  sourceModal: SourceDialogState | null;
  availableSources: CatalogSqlSource[];
  reportId?: number;
  unit?: string;
  currentReportParameters?: Record<string, any>;
  monthlyGoals?: Array<{ year: number; month: number; value: number }>;
  existingSources?: CanvasSource[];
  onChange: (next: SourceDialogState) => void;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
}

interface ParsedParamItem {
  key: string;
  isBinding: boolean;
  bindingKey: string;
  fixedValue: string;
  type: string;
}

export default function SourceDialog({
  sourceModal,
  availableSources,
  reportId = 1,
  unit = "",
  currentReportParameters = {},
  monthlyGoals = [],
  existingSources = [],
  onChange,
  onClose,
  onSubmit,
}: SourceDialogProps) {
  const sourceFormId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [searchCatalog, setSearchCatalog] = useState("");
  const [testing, setTesting] = useState(false);
  const [autoSlug, setAutoSlug] = useState(true);
  const [showAdvancedId, setShowAdvancedId] = useState(false);

  // Manual table state parsed from JSON
  const [gridColumns, setGridColumns] = useState<string[]>([]);
  const [gridRows, setGridRows] = useState<Array<Array<string | number | boolean | null>>>([]);

  // Initialize or sync grid state
  useEffect(() => {
    if (!sourceModal || sourceModal.type !== "inline") return;
    try {
      const cols = JSON.parse(sourceModal.columnsJson || "[]");
      const rows = JSON.parse(sourceModal.rowsJson || "[]");
      if (Array.isArray(cols)) setGridColumns(cols);
      if (Array.isArray(rows)) setGridRows(rows);
    } catch {
      // Fallback
    }
  }, [sourceModal?.columnsJson, sourceModal?.rowsJson, sourceModal?.type]);

  if (!sourceModal) return null;

  const isCreate = sourceModal.mode === "create";
  const idError = useMemo(() => {
    const res = validateSourceId(sourceModal.id, existingSources, sourceModal.originalId);
    return res.ok ? null : res.error;
  }, [existingSources, sourceModal.id, sourceModal.originalId]);

  const selectedCatalog = availableSources.find(
    (s) => s.id === Number(sourceModal.reportId),
  );

  // Filter available catalog reports
  const filteredCatalog = useMemo(() => {
    if (!searchCatalog.trim()) return availableSources;
    const term = searchCatalog.toLowerCase().trim();
    return availableSources.filter(
      (s) =>
        s.name.toLowerCase().includes(term) ||
        s.code.toLowerCase().includes(term),
    );
  }, [availableSources, searchCatalog]);

  // Handle label change and auto slug
  const handleLabelChange = (val: string) => {
    const trimmed = val.slice(0, 60);
    const updates: Partial<SourceDialogState> = { label: trimmed };
    if (autoSlug && isCreate) {
      const generated = slugifySourceName(trimmed);
      if (generated) updates.id = generated;
    }
    onChange({ ...sourceModal, ...updates });
  };

  const handleIdChange = (val: string) => {
    setAutoSlug(false);
    onChange({ ...sourceModal, id: val });
  };

  // Switch source type
  const handleTypeChange = (nextType: "report" | "inline" | "goals") => {
    let nextId = sourceModal.id;
    if (isCreate) {
      if (nextType === "goals") nextId = "metas";
      else if (nextType === "inline" && (!sourceModal.label || autoSlug)) nextId = "tabela_manual";
    }
    onChange({
      ...sourceModal,
      type: nextType,
      id: nextId,
      testPreview: null,
      testError: null,
      error: "",
    });
  };

  // Parameters list management for "report" source
  const currentParamsMap = useMemo(() => {
    try {
      const parsed = JSON.parse(sourceModal.parametersJson || "{}");
      return typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }, [sourceModal.parametersJson]);

  // Combined parameters: from catalog schema + existing custom parameters
  const paramItems = useMemo<ParsedParamItem[]>(() => {
    const items: ParsedParamItem[] = [];
    const seen = new Set<string>();

    // From current parameter JSON
    for (const [k, v] of Object.entries(currentParamsMap)) {
      seen.add(k);
      if (isParameterBinding(v)) {
        items.push({
          key: k,
          isBinding: true,
          bindingKey: v.parameter,
          fixedValue: "",
          type: "string",
        });
      } else {
        items.push({
          key: k,
          isBinding: false,
          bindingKey: "",
          fixedValue: v === null || v === undefined ? "" : String(v),
          type: typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "string",
        });
      }
    }

    return items;
  }, [currentParamsMap]);

  const updateParameterJson = (items: ParsedParamItem[]) => {
    const obj: Record<string, any> = {};
    for (const item of items) {
      if (!item.key.trim()) continue;
      const k = item.key.trim();
      if (item.isBinding) {
        obj[k] = { parameter: item.bindingKey.trim() || k };
      } else {
        if (item.type === "number") {
          const num = Number(item.fixedValue);
          obj[k] = Number.isFinite(num) ? num : item.fixedValue;
        } else if (item.type === "boolean") {
          obj[k] = item.fixedValue === "true";
        } else {
          obj[k] = item.fixedValue;
        }
      }
    }
    onChange({ ...sourceModal, parametersJson: JSON.stringify(obj, null, 2) });
  };

  const handleAddParam = () => {
    const newKey = `param_${paramItems.length + 1}`;
    const next = [
      ...paramItems,
      {
        key: newKey,
        isBinding: Object.keys(currentReportParameters).length > 0,
        bindingKey: Object.keys(currentReportParameters)[0] || "",
        fixedValue: "",
        type: "string",
      },
    ];
    updateParameterJson(next);
  };

  const handleRemoveParam = (index: number) => {
    const next = paramItems.filter((_, idx) => idx !== index);
    updateParameterJson(next);
  };

  const handleParamChange = (index: number, patch: Partial<ParsedParamItem>) => {
    const next = paramItems.map((item, idx) => (idx === index ? { ...item, ...patch } : item));
    updateParameterJson(next);
  };

  // Manual table grid operations
  const updateGridState = (
    newCols: string[],
    newRows: Array<Array<string | number | boolean | null>>,
  ) => {
    setGridColumns(newCols);
    setGridRows(newRows);
    onChange({
      ...sourceModal,
      columnsJson: JSON.stringify(newCols),
      rowsJson: JSON.stringify(newRows, null, 2),
    });
  };

  const handleAddColumn = () => {
    if (gridColumns.length >= 100) return;
    const name = `coluna_${gridColumns.length + 1}`;
    const newCols = [...gridColumns, name];
    const newRows = gridRows.map((r) => [...r, ""]);
    updateGridState(newCols, newRows);
  };

  const handleRemoveColumn = (colIdx: number) => {
    if (gridColumns.length <= 1) return;
    const newCols = gridColumns.filter((_, idx) => idx !== colIdx);
    const newRows = gridRows.map((r) => r.filter((_, idx) => idx !== colIdx));
    updateGridState(newCols, newRows);
  };

  const handleRenameColumn = (colIdx: number, newName: string) => {
    const newCols = [...gridColumns];
    newCols[colIdx] = newName.slice(0, 60);
    updateGridState(newCols, gridRows);
  };

  const handleAddRow = () => {
    if (gridRows.length >= 2000) return;
    const emptyRow = gridColumns.map(() => "");
    const newRows = [...gridRows, emptyRow];
    updateGridState(gridColumns, newRows);
  };

  const handleRemoveRow = (rowIdx: number) => {
    const newRows = gridRows.filter((_, idx) => idx !== rowIdx);
    updateGridState(gridColumns, newRows);
  };

  const handleCellChange = (rowIdx: number, colIdx: number, val: string) => {
    const newRows = gridRows.map((r, rIdx) => {
      if (rIdx !== rowIdx) return r;
      const nextR = [...r];
      nextR[colIdx] = val;
      return nextR;
    });
    updateGridState(gridColumns, newRows);
  };

  // Handle Ctrl+V paste on grid
  const handlePasteOnGrid = (e: ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text || (!text.includes("\t") && !text.includes(";") && !text.includes(","))) return;
    e.preventDefault();
    const parsed = parsePastedTable(text);
    if (parsed.columns.length > 0) {
      updateGridState(parsed.columns, parsed.rows);
    }
  };

  // Handle CSV file upload
  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = String(evt.target?.result || "");
      if (text) {
        const parsed = parsePastedTable(text);
        if (parsed.columns.length > 0) {
          updateGridState(parsed.columns, parsed.rows);
        }
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // Draft source construction for testing preview & saving
  const constructDraftSource = (): CanvasSource => {
    const label = sourceModal.label?.trim() || undefined;
    if (sourceModal.type === "report") {
      let params = {};
      try {
        params = JSON.parse(sourceModal.parametersJson || "{}");
      } catch {
        // Fallback
      }
      return {
        id: sourceModal.id.trim(),
        type: "report",
        report_id: Number(sourceModal.reportId) || 1,
        label,
        dataset: sourceModal.dataset || selectedCatalog?.datasets?.[0]?.id,
        parameters: params,
      };
    }
    if (sourceModal.type === "inline") {
      return {
        id: sourceModal.id.trim(),
        type: "inline",
        label,
        columns: gridColumns,
        rows: gridRows,
      };
    }
    return {
      id: sourceModal.id.trim(),
      type: "goals",
      label,
    };
  };

  // Test and load preview
  const handleTestPreview = async () => {
    setTesting(true);
    onChange({ ...sourceModal, testError: null, testPreview: null });
    try {
      const draft = constructDraftSource();
      const preview = await fetchSourcePreviewRequest(
        reportId,
        unit,
        draft,
        {},
        10,
      );
      onChange({ ...sourceModal, testPreview: preview, testError: null });
    } catch (err: any) {
      const msg = err?.message || "Falha ao carregar prévia.";
      onChange({ ...sourceModal, testError: msg, testPreview: null });
    } finally {
      setTesting(false);
    }
  };

  const draftSource = constructDraftSource();
  const inferredGridTypes = useMemo(() => {
    return gridColumns.map((_, colIdx) => {
      const colValues = gridRows.map((r) => r[colIdx]);
      return inferColumnType(colValues);
    });
  }, [gridColumns, gridRows]);

  return (
    <InlineDialog
      title={isCreate ? "Adicionar fonte de dados" : "Editar fonte de dados"}
      subtitle="Fontes integradas ao relatório para alimentar tabelas, gráficos e KPIs"
      className="rc-subdialog cv-root"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="cv-btn-compact" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="cv-btn-compact"
            onClick={handleTestPreview}
            disabled={testing || Boolean(idError)}
            title="Executar consulta e verificar dados retornados"
          >
            <RefreshCw size={12} className={testing ? "spin" : ""} />
            {testing ? "Testando…" : "Testar e carregar prévia"}
          </button>
          <button
            type="submit"
            form={sourceFormId}
            className="cv-btn-compact primary"
            disabled={Boolean(idError)}
          >
            {sourceModal.testError ? "Salvar sem testar" : "Salvar fonte"}
          </button>
        </>
      }
    >
      <form id={sourceFormId} className="rc-subform" onSubmit={onSubmit}>
        {sourceModal.error && (
          <p className="inline-error" role="alert">
            <AlertCircle size={14} />
            {sourceModal.error}
          </p>
        )}

        {/* 1. Nome amigável e Identificador técnico */}
        <div className="rc-grid-2">
          <label className="op-field">
            <span>Nome da fonte</span>
            <input
              type="text"
              maxLength={60}
              placeholder="Ex.: Faturamento Mensal"
              value={sourceModal.label || ""}
              onChange={(e) => handleLabelChange(e.target.value)}
              autoFocus
            />
          </label>

          <label className="op-field">
            <span style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Identificador técnico</span>
              {!showAdvancedId && (
                <button
                  type="button"
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--cv-accent)",
                    cursor: "pointer",
                    fontSize: "11px",
                    padding: 0,
                  }}
                  onClick={() => setShowAdvancedId(true)}
                >
                  Editar id
                </button>
              )}
            </span>
            <input
              type="text"
              required
              maxLength={50}
              className="cv-font-mono"
              placeholder="Ex.: faturamento_mensal"
              value={sourceModal.id}
              onChange={(e) => handleIdChange(e.target.value)}
              disabled={!showAdvancedId && isCreate}
            />
            {idError && (
              <span className="inline-error" style={{ fontSize: "11px", marginTop: "2px" }}>
                {idError}
              </span>
            )}
          </label>
        </div>

        {/* 2. Tipo de Fonte (Segmented control) */}
        <div className="op-field">
          <span>Tipo de dados</span>
          <div className="cv-segmented" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={sourceModal.type === "report"}
              className={`cv-segmented-btn ${sourceModal.type === "report" ? "active" : ""}`}
              onClick={() => handleTypeChange("report")}
            >
              <Database size={13} style={{ marginRight: 6, verticalAlign: "middle" }} />
              Relatório existente
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sourceModal.type === "inline"}
              className={`cv-segmented-btn ${sourceModal.type === "inline" ? "active" : ""}`}
              onClick={() => handleTypeChange("inline")}
            >
              <Table size={13} style={{ marginRight: 6, verticalAlign: "middle" }} />
              Tabela manual
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sourceModal.type === "goals"}
              className={`cv-segmented-btn ${sourceModal.type === "goals" ? "active" : ""}`}
              onClick={() => handleTypeChange("goals")}
            >
              <Target size={13} style={{ marginRight: 6, verticalAlign: "middle" }} />
              Metas mensais
            </button>
          </div>
        </div>

        {/* 3. Conteúdo para Relatório Existente */}
        {sourceModal.type === "report" && (
          <>
            <div className="rc-grid-2">
              <label className="op-field">
                <span>Relatório cadastrado na unidade</span>
                <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                  <div style={{ position: "relative", flex: 1 }}>
                    <Search
                      size={12}
                      style={{
                        position: "absolute",
                        left: 8,
                        top: 8,
                        color: "var(--cv-text-3)",
                      }}
                    />
                    <input
                      type="search"
                      placeholder="Buscar por nome ou código..."
                      value={searchCatalog}
                      onChange={(e) => setSearchCatalog(e.target.value)}
                      style={{ paddingLeft: 26, height: "28px", fontSize: "12px", width: "100%" }}
                    />
                  </div>
                </div>
                <Select
                  required
                  value={sourceModal.reportId}
                  onChange={(e) =>
                    onChange({
                      ...sourceModal,
                      reportId: e.target.value,
                      dataset: undefined,
                      testPreview: null,
                    })
                  }
                >
                  <option value="">Selecione um relatório</option>
                  {filteredCatalog.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.code}
                    </option>
                  ))}
                </Select>
              </label>

              {!!selectedCatalog?.datasets?.length && (
                <label className="op-field">
                  <span>Conjunto de dados</span>
                  <Select
                    value={sourceModal.dataset || selectedCatalog.datasets[0]?.id || ""}
                    onChange={(e) =>
                      onChange({ ...sourceModal, dataset: e.target.value, testPreview: null })
                    }
                  >
                    {selectedCatalog.datasets.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.columns?.length || 0} colunas)
                      </option>
                    ))}
                  </Select>
                </label>
              )}
            </div>

            {/* Seção de Parâmetros */}
            <div className="cv-params-section">
              <div className="cv-params-head">
                <span className="cv-params-title">Parâmetros da consulta</span>
                <button
                  type="button"
                  className="cv-btn-compact"
                  onClick={handleAddParam}
                  title="Adicionar parâmetro de consulta"
                >
                  <Plus size={12} />
                  Adicionar parâmetro
                </button>
              </div>

              {paramItems.length === 0 ? (
                <p className="rc-hint" style={{ margin: "4px 0" }}>
                  Nenhum parâmetro configurado. A fonte usará os valores padrão da consulta.
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {paramItems.map((param, idx) => (
                    <div key={idx} className="cv-param-card">
                      <div className="cv-param-row">
                        <input
                          type="text"
                          placeholder="Nome (ex.: start)"
                          value={param.key}
                          onChange={(e) => handleParamChange(idx, { key: e.target.value })}
                          className="cv-font-mono"
                          style={{ height: "28px", fontSize: "12px" }}
                        />

                        {param.isBinding ? (
                          <Select
                            value={param.bindingKey}
                            onChange={(e) => handleParamChange(idx, { bindingKey: e.target.value })}
                            aria-label="Parâmetro do relatório atual"
                          >
                            <option value="">Selecione parâmetro atual</option>
                            {Object.keys(currentReportParameters).map((pKey) => (
                              <option key={pKey} value={pKey}>
                                Parâmetro do relatório: {pKey}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <input
                            type="text"
                            placeholder="Valor fixo"
                            value={param.fixedValue}
                            onChange={(e) =>
                              handleParamChange(idx, { fixedValue: e.target.value })
                            }
                            style={{ height: "28px", fontSize: "12px" }}
                          />
                        )}

                        <button
                          type="button"
                          className="cv-icon-btn danger"
                          onClick={() => handleRemoveParam(idx)}
                          title="Remover parâmetro"
                          aria-label="Remover parâmetro"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>

                      <div className="cv-param-mode-toggle">
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <input
                            type="radio"
                            name={`param_mode_${idx}`}
                            checked={param.isBinding}
                            onChange={() => handleParamChange(idx, { isBinding: true })}
                          />
                          <span>Usar parâmetro do relatório atual</span>
                        </label>
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <input
                            type="radio"
                            name={`param_mode_${idx}`}
                            checked={!param.isBinding}
                            onChange={() => handleParamChange(idx, { isBinding: false })}
                          />
                          <span>Valor fixo</span>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* 4. Conteúdo para Tabela Manual */}
        {sourceModal.type === "inline" && (
          <div className="cv-table-editor" onPaste={handlePasteOnGrid}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              hidden
              onChange={handleFileUpload}
            />

            <div className="cv-table-editor-toolbar">
              <span className="cv-table-editor-stats">
                {gridColumns.length} colunas (máx 100) × {gridRows.length} linhas (máx 2000)
              </span>

              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  className="cv-btn-compact"
                  onClick={handleAddColumn}
                  title="Adicionar coluna"
                >
                  <Plus size={12} /> Coluna
                </button>
                <button
                  type="button"
                  className="cv-btn-compact"
                  onClick={handleAddRow}
                  title="Adicionar linha"
                >
                  <Plus size={12} /> Linha
                </button>
                <button
                  type="button"
                  className="cv-btn-compact"
                  onClick={() => fileInputRef.current?.click()}
                  title="Importar dados de arquivo CSV"
                >
                  <Upload size={12} /> Importar .csv
                </button>
              </div>
            </div>

            <div className="cv-table-editor-scroll">
              <table className="cv-grid-table">
                <thead>
                  <tr>
                    <th style={{ width: 32, textAlign: "center" }}>#</th>
                    {gridColumns.map((colName, cIdx) => (
                      <th key={cIdx}>
                        <div className="cv-grid-header-cell">
                          <ColumnBadge type={inferredGridTypes[cIdx]} />
                          <input
                            type="text"
                            value={colName}
                            onChange={(e) => handleRenameColumn(cIdx, e.target.value)}
                            className="cv-grid-input"
                            style={{ fontWeight: 600 }}
                            title="Nome da coluna"
                          />
                          {gridColumns.length > 1 && (
                            <button
                              type="button"
                              className="cv-icon-btn danger"
                              style={{ width: 20, height: 20 }}
                              onClick={() => handleRemoveColumn(cIdx)}
                              title="Remover coluna"
                            >
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      </th>
                    ))}
                    <th style={{ width: 32 }} />
                  </tr>
                </thead>
                <tbody>
                  {gridRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={gridColumns.length + 2}
                        style={{ textAlign: "center", padding: "16px", color: "var(--cv-text-3)" }}
                      >
                        Nenhuma linha. Clique em "+ Linha" ou cole dados do Excel (Ctrl+V).
                      </td>
                    </tr>
                  ) : (
                    gridRows.map((row, rIdx) => (
                      <tr key={rIdx}>
                        <td style={{ textAlign: "center", color: "var(--cv-text-disabled)" }}>
                          {rIdx + 1}
                        </td>
                        {gridColumns.map((_, cIdx) => (
                          <td key={cIdx}>
                            <input
                              type="text"
                              value={row[cIdx] === null || row[cIdx] === undefined ? "" : String(row[cIdx])}
                              onChange={(e) => handleCellChange(rIdx, cIdx, e.target.value)}
                              className="cv-grid-input"
                            />
                          </td>
                        ))}
                        <td style={{ textAlign: "center" }}>
                          <button
                            type="button"
                            className="cv-icon-btn danger"
                            style={{ width: 20, height: 20 }}
                            onClick={() => handleRemoveRow(rIdx)}
                            title="Remover linha"
                          >
                            <Trash2 size={11} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <span className="rc-hint">
              Dica: você pode copiar uma tabela do Excel ou Google Sheets e colar com Ctrl+V aqui.
            </span>
          </div>
        )}

        {/* 5. Conteúdo para Metas Mensais */}
        {sourceModal.type === "goals" && (
          <div className="cv-table-editor">
            <p className="rc-hint" style={{ margin: "4px 0" }}>
              Utiliza as metas mensais cadastradas neste relatório com as colunas fixas:{" "}
              <code>year</code>, <code>month</code> e <code>value</code>.
            </p>
            {monthlyGoals.length > 0 ? (
              <div className="cv-table-editor-scroll" style={{ maxHeight: 160 }}>
                <table className="cv-grid-table">
                  <thead>
                    <tr>
                      <th>Ano (year)</th>
                      <th>Mês (month)</th>
                      <th>Valor (value)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyGoals.map((g, idx) => (
                      <tr key={idx}>
                        <td>{g.year}</td>
                        <td>{g.month}</td>
                        <td style={{ textAlign: "right" }}>{g.value.toLocaleString("pt-BR")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rc-hint" style={{ color: "var(--cv-warning)" }}>
                Nenhuma meta cadastrada nas configurações do relatório.
              </p>
            )}
          </div>
        )}

        {/* 6. Test Preview dentro do Diálogo */}
        {testing && (
          <div className="cv-test-preview" style={{ textAlign: "center", padding: "16px" }}>
            <RefreshCw size={14} className="spin" style={{ marginRight: 6 }} />
            Executando prévia dos dados...
          </div>
        )}

        {sourceModal.testError && (
          <div className="cv-test-preview" style={{ borderColor: "var(--cv-danger-line)" }}>
            <p className="inline-error" style={{ margin: 0 }}>
              <AlertCircle size={14} />
              {sourceModal.testError}
            </p>
          </div>
        )}

        {sourceModal.testPreview && (
          <div className="cv-test-preview">
            <div className="cv-test-preview-head">
              <span>
                <strong>Prévia confirmada:</strong> {sourceModal.testPreview.columns.length} colunas ·{" "}
                {sourceModal.testPreview.rows.length} de {sourceModal.testPreview.total_rows} linhas{" "}
                {sourceModal.testPreview.elapsed_ms != null ? `(${sourceModal.testPreview.elapsed_ms} ms)` : ""}
              </span>
              <span className="cv-chip ready">
                <Check size={10} /> Teste com sucesso
              </span>
            </div>

            <div style={{ overflowX: "auto", maxHeight: 180 }}>
              <table className="cv-preview-table">
                <thead>
                  <tr>
                    {sourceModal.testPreview.columns.map((col, idx) => (
                      <th key={idx}>
                        <div className="cv-table-th-content">
                          <ColumnBadge type={col.type} looksLike={col.looks_like} />
                          <span>{col.name}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sourceModal.testPreview.rows.slice(0, 10).map((row, rIdx) => (
                    <tr key={rIdx}>
                      {sourceModal.testPreview!.columns.map((col, cIdx) => (
                        <td key={cIdx} className={col.type === "number" ? "cell-number" : ""}>
                          {row[cIdx] === null || row[cIdx] === undefined ? "—" : String(row[cIdx])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 7. Detalhes avançados (JSON somente leitura) */}
        <details className="cv-details-advanced">
          <summary>Detalhes avançados (JSON da especificação)</summary>
          <pre className="cv-json-preview">{JSON.stringify(draftSource, null, 2)}</pre>
        </details>
      </form>
    </InlineDialog>
  );
}
