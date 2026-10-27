import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, Braces, Image as ImageIcon, Plus, Upload } from "lucide-react";
import ColumnBadge from "../../data/ColumnBadge";
import type {
  AggregateMode,
  CanvasAssetMeta,
  CanvasBlock,
  CanvasLayout,
  CanvasSource,
  ChartAggregateMode,
  ColumnInfo,
  SourcePreview,
  XGroupGranularity,
} from "../../model";
import { COMPONENT_NAMES } from "../../library/BlockLibrary";
import { SERIES_PALETTE, clamp } from "../../model";
import { testParameters } from "../../parameters";
import {
  adjustWidthsProportionally,
  computeKpiPreviewSample,
  convertChartTypePreservingFields,
  formatDateGroupPreview,
  interpolateTextPreview,
  isDateCompatibleColumn,
  isNumericCompatibleColumn,
} from "../inspectorOps";
import CollapsibleSection from "./CollapsibleSection";
import ColumnSelect from "./ColumnSelect";
import FieldWell from "./FieldWell";
import NumberField from "./NumberField";
import SegmentedControl from "./SegmentedControl";

export interface ContentFieldsProps {
  block: CanvasBlock;
  hidden: boolean;
  layout?: CanvasLayout;
  sources: CanvasSource[];
  columnInfos: readonly ColumnInfo[];
  rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null>>;
  totalRows?: number;
  hasRows?: boolean;
  previewUnavailable?: boolean;
  assets: CanvasAssetMeta[];
  assetUrls?: Record<string, string>;
  uploadingAsset: boolean;
  reportName?: string;
  parameterSchema?: Record<string, unknown>;
  sourcePreviews?: Record<string, SourcePreview | null | undefined>;
  onTriggerImageUpload: (blockId: string) => void;
  onColumnWidthsValidation: (blockId: string | null, errorMessage?: string) => void;
  onUpdateBlock: (
    blockId: string,
    label: string,
    updater: (b: CanvasBlock) => CanvasBlock,
    coalesceKey?: string,
  ) => void;
}

const CHART_TYPE_OPTIONS = [
  { value: "bar" as const, label: "Barras" },
  { value: "line" as const, label: "Linhas" },
  { value: "pie" as const, label: "Pizza" },
];

const X_GROUP_SEGMENT_OPTIONS = [
  { value: "day" as const, label: "Dia", title: "Agrupar por dia (DD/MM/AAAA)" },
  { value: "week" as const, label: "Semana", title: "Agrupar por semana (sem. DD/MM)" },
  { value: "month" as const, label: "Mês", title: "Agrupar por mês (mmm/AA)" },
  { value: "quarter" as const, label: "Trim.", title: "Agrupar por trimestre (TN/AA)" },
  { value: "year" as const, label: "Ano", title: "Agrupar por ano (AAAA)" },
];

const KPI_AGG_OPTIONS = [
  { value: "sum" as const, label: "Soma" },
  { value: "count" as const, label: "Contagem" },
  { value: "first" as const, label: "Primeiro" },
];

const WIDTH_MODE_OPTIONS = [
  { value: "auto" as const, label: "Automático" },
  { value: "manual" as const, label: "Manual" },
];

const IMAGE_FIT_OPTIONS = [
  { value: "contain" as const, label: "Conter sem cortar" },
];

export default function ContentFields({
  block,
  hidden,
  layout,
  sources,
  columnInfos,
  rows,
  totalRows,
  hasRows = false,
  previewUnavailable = false,
  assets,
  assetUrls,
  uploadingAsset,
  reportName = "Relatório",
  parameterSchema,
  sourcePreviews,
  onTriggerImageUpload,
  onColumnWidthsValidation,
  onUpdateBlock,
}: ContentFieldsProps) {
  const autoId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const varMenuRef = useRef<HTMLDivElement>(null);

  const [pieNotice, setPieNotice] = useState<string | null>(null);
  const [varMenuOpen, setVarMenuOpen] = useState(false);
  const [dragColIdx, setDragColIdx] = useState<number | null>(null);

  useEffect(() => {
    setPieNotice(null);
    setVarMenuOpen(false);
  }, [block.id, block.type]);

  useEffect(() => {
    if (!varMenuOpen) return;
    const onOutside = (e: PointerEvent) => {
      if (!varMenuRef.current?.contains(e.target as Node)) {
        setVarMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onOutside);
    return () => document.removeEventListener("pointerdown", onOutside);
  }, [varMenuOpen]);

  const opt = block.options || {};
  const isChart = block.type === "bar" || block.type === "line" || block.type === "pie";

  // Chart derived state
  const xField = opt.x_field || "";
  const yFields = opt.y_fields || [];
  const xColInfo = useMemo(
    () => columnInfos.find((c) => c.name === xField),
    [columnInfos, xField],
  );
  const showXGroupControl =
    isChart &&
    (Boolean(opt.x_group) ||
      isDateCompatibleColumn(xColInfo) ||
      (previewUnavailable && Boolean(xField)));

  const sampleXValue = useMemo(() => {
    if (!xColInfo) return null;
    if (xColInfo.sample && xColInfo.sample.length > 0) return xColInfo.sample[0];
    const colIdx = columnInfos.findIndex((c) => c.name === xField);
    if (colIdx >= 0 && rows.length > 0) {
      const nonNull = rows.find((r) => r[colIdx] != null && r[colIdx] !== "");
      return nonNull ? String(nonNull[colIdx]) : null;
    }
    return null;
  }, [columnInfos, rows, xColInfo, xField]);

  const activeGroupPreview = opt.x_group
    ? formatDateGroupPreview(opt.x_group, sampleXValue)
    : formatDateGroupPreview("month", sampleXValue);

  // Table derived state
  const allColNames = useMemo(() => columnInfos.map((c) => c.name), [columnInfos]);
  const selectedTableCols = useMemo(() => {
    if (block.type !== "table") return [];
    if (Array.isArray(opt.columns)) return opt.columns;
    return allColNames;
  }, [allColNames, block.type, opt.columns]);

  const orderedChecklistCols = useMemo(() => {
    if (block.type !== "table") return [];
    const seen = new Set<string>();
    const list: Array<{ name: string; checked: boolean; info?: ColumnInfo }> = [];
    for (const colName of selectedTableCols) {
      if (seen.has(colName)) continue;
      seen.add(colName);
      list.push({
        name: colName,
        checked: true,
        info: columnInfos.find((c) => c.name === colName),
      });
    }
    for (const info of columnInfos) {
      if (seen.has(info.name)) continue;
      seen.add(info.name);
      list.push({
        name: info.name,
        checked: false,
        info,
      });
    }
    return list;
  }, [block.type, columnInfos, selectedTableCols]);

  const manualWidths = opt.column_widths;
  const isManualWidthMode = Boolean(manualWidths && manualWidths.length > 0);
  const widthSum = useMemo(
    () => (manualWidths ? manualWidths.reduce((acc, w) => acc + (Number(w) || 0), 0) : 0),
    [manualWidths],
  );
  const widthExceedsBlock = isManualWidthMode && widthSum > block.width + 0.5;
  const widthCountMismatch =
    isManualWidthMode &&
    selectedTableCols.length > 0 &&
    manualWidths!.length !== selectedTableCols.length;

  useEffect(() => {
    if (block.type !== "table") return;
    if (widthExceedsBlock) {
      onColumnWidthsValidation(
        block.id,
        `Soma das larguras (${Math.round(widthSum)} px) excede o bloco (${Math.round(block.width)} px).`,
      );
    } else if (widthCountMismatch) {
      onColumnWidthsValidation(
        block.id,
        "Informe uma largura para cada coluna selecionada na tabela.",
      );
    } else {
      onColumnWidthsValidation(null);
    }
  }, [
    block.id,
    block.type,
    block.width,
    onColumnWidthsValidation,
    widthCountMismatch,
    widthExceedsBlock,
    widthSum,
  ]);

  // KPI sample preview
  const kpiSample = useMemo(
    () => (hasRows ? computeKpiPreviewSample(block, columnInfos, rows, totalRows) : null),
    [block, columnInfos, hasRows, rows, totalRows],
  );

  // Text variable insertion options
  const variableItems = useMemo(() => {
    if (block.type !== "text") return [];
    const items: Array<{ token: string; desc: string }> = [
      { token: "{{report_name}}", desc: "Nome do relatório" },
    ];
    if (parameterSchema) {
      for (const param of testParameters(parameterSchema)) {
        items.push({ token: `{{${param.name}}}`, desc: `Parâmetro: ${param.label}` });
      }
    }
    const candidateSources = block.source_id
      ? sources.filter((s) => s.id === block.source_id)
      : sources;
    for (const src of candidateSources) {
      const cols =
        src.id === block.source_id && columnInfos.length > 0
          ? columnInfos.map((c) => c.name)
          : src.type === "inline"
            ? src.columns
            : src.type === "goals"
              ? ["year", "month", "value"]
              : [];
      for (const col of cols.slice(0, 20)) {
        items.push({
          token: `{{${src.id}.${col}}}`,
          desc: `${src.label || src.id} › ${col}`,
        });
      }
    }
    return items;
  }, [block.source_id, block.type, columnInfos, parameterSchema, sources]);

  const textHasInterpolation = Boolean(block.type === "text" && /\{\{.+?\}\}/.test(block.text || ""));
  const interpolatedPreview = useMemo(() => {
    if (!textHasInterpolation) return "";
    return interpolateTextPreview(block.text || "", {
      reportName,
      sources,
      previews: sourcePreviews,
    });
  }, [block.text, reportName, sourcePreviews, sources, textHasInterpolation]);

  // Image asset metadata & usage count
  const selectedAsset = useMemo(
    () => (block.type === "image" && block.asset_id ? assets.find((a) => a.id === block.asset_id) || null : null),
    [assets, block.asset_id, block.type],
  );
  const assetUsageCount = useMemo(() => {
    if (!selectedAsset || !layout) return 1;
    let count = 0;
    for (const p of layout.pages) {
      for (const b of p.blocks) {
        if (b.type === "image" && b.asset_id === selectedAsset.id) count += 1;
      }
    }
    return Math.max(1, count);
  }, [layout, selectedAsset]);

  if (hidden) return null;

  const insertVariableIntoText = (token: string) => {
    const el = textareaRef.current;
    const current = block.text || "";
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const nextText = (current.slice(0, start) + token + current.slice(end)).slice(0, 20000);
    onUpdateBlock(block.id, "Inserir variável no texto", (b) => ({
      ...b,
      text: nextText,
    }));
    setVarMenuOpen(false);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        const caret = Math.min(nextText.length, start + token.length);
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(caret, caret);
      }
    });
  };

  const moveTableCol = (colName: string, dir: -1 | 1) => {
    const idx = selectedTableCols.indexOf(colName);
    const targetIdx = idx + dir;
    if (idx < 0 || targetIdx < 0 || targetIdx >= selectedTableCols.length) return;
    const reordered = [...selectedTableCols];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(targetIdx, 0, moved);

    onUpdateBlock(block.id, "Reordenar colunas da tabela", (b) => {
      const nextWidths =
        b.options?.column_widths && b.options.column_widths.length === selectedTableCols.length
          ? (() => {
              const ws = [...b.options.column_widths];
              const [mw] = ws.splice(idx, 1);
              ws.splice(targetIdx, 0, mw);
              return ws;
            })()
          : b.options?.column_widths;
      return {
        ...b,
        options: {
          ...b.options,
          columns: reordered,
          ...(nextWidths ? { column_widths: nextWidths } : {}),
        },
      };
    });
  };

  return (
    <>
      {/* 1. Seção Geral / Identificação */}
      <CollapsibleSection title="Conteúdo" defaultOpen={true}>
        {isChart && (
          <div className="cv-field">
            <span className="cv-label">Tipo de gráfico</span>
            <SegmentedControl
              id="insp-chart-type"
              ariaLabel="Tipo de gráfico"
              options={CHART_TYPE_OPTIONS}
              value={block.type as "bar" | "line" | "pie"}
              onChange={(nextType) => {
                if (nextType === block.type) return;
                const { droppedExtraSeriesCount } = convertChartTypePreservingFields(
                  block,
                  nextType,
                );
                if (droppedExtraSeriesCount > 0) {
                  setPieNotice(
                    "Gráfico de pizza aceita apenas 1 série; a 1ª série foi mantida (use Ctrl+Z para desfazer).",
                  );
                } else {
                  setPieNotice(null);
                }
                onUpdateBlock(block.id, `Alterar gráfico para ${COMPONENT_NAMES[nextType]}`, (b) => {
                  return convertChartTypePreservingFields(b, nextType).block;
                });
              }}
            />
            {pieNotice && <p className="cv-field-warn">{pieNotice}</p>}
          </div>
        )}

        <div className="cv-field">
          <label htmlFor={`${autoId}-title`} className="cv-label">
            Título
          </label>
          <input
            id={`${autoId}-title`}
            type="text"
            className="cv-input"
            maxLength={300}
            placeholder={COMPONENT_NAMES[block.type]}
            value={block.title || ""}
            onChange={(e) =>
              onUpdateBlock(
                block.id,
                "Editar título do bloco",
                (b) => ({ ...b, title: e.target.value }),
                `title:${block.id}`,
              )
            }
          />
        </div>

        {/* TEXTO */}
        {block.type === "text" && (
          <>
            <div className="cv-field">
              <div className="cv-field-top">
                <label htmlFor="insp-text-body" className="cv-label">
                  Texto
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span className="cv-field-counter">
                    {(block.text || "").length.toLocaleString("pt-BR")} / 20.000
                  </span>
                  <div ref={varMenuRef} className="cv-insp-menu-anchor">
                    <button
                      type="button"
                      className="cv-btn-compact"
                      aria-haspopup="menu"
                      aria-expanded={varMenuOpen}
                      onClick={() => setVarMenuOpen((v) => !v)}
                    >
                      <Braces size={11} aria-hidden="true" />
                      Inserir variável
                    </button>
                    {varMenuOpen && (
                      <div className="cv-insp-menu" role="menu" aria-label="Variáveis disponíveis">
                        {variableItems.map((v) => (
                          <button
                            key={v.token}
                            type="button"
                            role="menuitem"
                            className="cv-insp-menu-item"
                            onClick={() => insertVariableIntoText(v.token)}
                          >
                            <span style={{ fontFamily: "var(--cv-font-mono)", fontSize: "11px" }}>
                              {v.token}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <textarea
                id="insp-text-body"
                ref={textareaRef}
                className="cv-textarea"
                rows={5}
                maxLength={20000}
                placeholder="Digite o conteúdo ou insira variáveis…"
                value={block.text || ""}
                onChange={(e) =>
                  onUpdateBlock(
                    block.id,
                    "Editar texto do bloco",
                    (b) => ({ ...b, text: e.target.value }),
                    `text:${block.id}`,
                  )
                }
              />
            </div>

            {textHasInterpolation && (
              <div className="cv-field">
                <span className="cv-label">Resultado interpolado</span>
                <div className="cv-text-preview-box" aria-live="polite">
                  {interpolatedPreview}
                </div>
              </div>
            )}
          </>
        )}

        {/* IMAGEM */}
        {block.type === "image" && (
          <>
            <div className="cv-field">
              <div className="cv-field-top">
                <label htmlFor="insp-image-asset" className="cv-label">
                  Arquivo de imagem
                </label>
                <button
                  type="button"
                  className="cv-btn-compact"
                  disabled={uploadingAsset}
                  onClick={() => onTriggerImageUpload(block.id)}
                >
                  <Upload size={12} aria-hidden="true" />
                  {uploadingAsset ? "Enviando…" : "Enviar nova"}
                </button>
              </div>
              <select
                id="insp-image-asset"
                className="cv-input"
                aria-invalid={!block.asset_id ? true : undefined}
                value={block.asset_id || ""}
                onChange={(e) =>
                  onUpdateBlock(block.id, "Vincular imagem ao bloco", (b) => ({
                    ...b,
                    asset_id: e.target.value || undefined,
                  }))
                }
              >
                <option value="">Selecionar imagem enviada…</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.filename} ({a.width}×{a.height} px)
                  </option>
                ))}
              </select>
            </div>

            {selectedAsset && (
              <div className="cv-asset-card">
                {assetUrls?.[selectedAsset.id] ? (
                  <img
                    src={assetUrls[selectedAsset.id]}
                    alt={selectedAsset.filename}
                    className="cv-asset-thumb"
                  />
                ) : (
                  <div className="cv-asset-thumb" aria-hidden="true">
                    <ImageIcon size={18} />
                  </div>
                )}
                <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                  <strong
                    style={{
                      fontSize: "12px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {selectedAsset.filename}
                  </strong>
                  <span className="cv-field-hint">
                    {selectedAsset.width} × {selectedAsset.height} px · usada em {assetUsageCount}{" "}
                    {assetUsageCount === 1 ? "bloco" : "blocos"}
                  </span>
                </div>
              </div>
            )}

            <div className="cv-field">
              <span className="cv-label">Ajuste no quadro</span>
              <SegmentedControl
                ariaLabel="Ajuste da imagem"
                options={IMAGE_FIT_OPTIONS}
                value="contain"
                onChange={() => {}}
              />
            </div>
          </>
        )}
      </CollapsibleSection>

      {/* 2. GRÁFICO: Eixos, Agrupamento de datas e Séries */}
      {isChart && (
        <CollapsibleSection title="Eixos e séries" defaultOpen={true}>
          <ColumnSelect
            id="insp-chart-x"
            label={block.type === "pie" ? "Categoria" : "Eixo X"}
            value={xField}
            columns={columnInfos}
            placeholder={
              block.type === "pie" ? "Escolher coluna de categoria…" : "Escolher coluna do eixo X…"
            }
            error={!xField && block.source_id ? "Selecione uma coluna para o eixo." : undefined}
            onChange={(colName) => {
              const chosenInfo = columnInfos.find((c) => c.name === colName);
              const isDate = isDateCompatibleColumn(chosenInfo);
              onUpdateBlock(block.id, "Definir eixo X do gráfico", (b) => ({
                ...b,
                options: {
                  ...b.options,
                  x_field: colName,
                  x_group: isDate && !previewUnavailable ? b.options?.x_group || "month" : undefined,
                  y_aggregate:
                    isDate && !previewUnavailable
                      ? b.options?.y_aggregate || "sum"
                      : b.options?.y_aggregate,
                },
              }));
            }}
          />

          {showXGroupControl && (
            <div className="cv-field">
              <div className="cv-field-top">
                <span className="cv-label">Agrupar por</span>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  {opt.x_group && (
                    <span className="cv-field-counter" title="Exemplo do rótulo resultante">
                      Ex.: {activeGroupPreview}
                    </span>
                  )}
                  {opt.x_group && !previewUnavailable && (
                    <button
                      type="button"
                      className="cv-btn-compact"
                      style={{ height: 20, padding: "0 6px", fontSize: "11px" }}
                      onClick={() =>
                        onUpdateBlock(block.id, "Remover agrupamento de datas", (b) => ({
                          ...b,
                          options: { ...b.options, x_group: undefined },
                        }))
                      }
                    >
                      Sem agrupar
                    </button>
                  )}
                </div>
              </div>
              <SegmentedControl
                id="insp-chart-x-group"
                ariaLabel="Agrupar datas por período"
                options={X_GROUP_SEGMENT_OPTIONS}
                value={opt.x_group || "month"}
                disabled={previewUnavailable}
                disabledReason="Requer atualização do servidor"
                onChange={(gran: XGroupGranularity) =>
                  onUpdateBlock(block.id, "Alterar agrupamento de datas", (b) => ({
                    ...b,
                    options: {
                      ...b.options,
                      x_group: gran,
                      y_aggregate: b.options?.y_aggregate || "sum",
                    },
                  }))
                }
              />
              {previewUnavailable ? (
                <p className="cv-field-hint">Requer atualização do servidor.</p>
              ) : !opt.x_group ? (
                <p className="cv-field-hint">
                  Sem agrupamento ativo. Selecione um período (ex.: Mês → &ldquo;{activeGroupPreview}&rdquo;).
                </p>
              ) : null}
            </div>
          )}

          {/* Séries (Y) */}
          <div className="cv-field">
            <div className="cv-field-top">
              <span className="cv-label">
                {block.type === "pie" ? "Série de valores (Y)" : "Séries (Y)"}
              </span>
              <span className="cv-field-counter">
                {yFields.length}/{block.type === "pie" ? 1 : 6}
              </span>
            </div>

            <div className="cv-well-list">
              {(yFields.length > 0 ? yFields : [""]).map((yCol, idx, arr) => {
                const palette = opt.series_colors?.length ? opt.series_colors : SERIES_PALETTE;
                const seriesColor = palette[idx % palette.length];
                return (
                  <FieldWell
                    key={`${idx}-${arr.length}`}
                    id={`insp-chart-y-${idx}`}
                    index={idx}
                    total={arr.length}
                    value={yCol}
                    columns={columnInfos}
                    onlyNumeric={opt.y_aggregate !== "count"}
                    seriesColor={seriesColor}
                    showSigma={Boolean(opt.y_aggregate || opt.x_group)}
                    canMoveUp={idx > 0}
                    canMoveDown={idx < arr.length - 1}
                    canRemove={arr.length > 1 || Boolean(yCol)}
                    onChange={(nextCol) =>
                      onUpdateBlock(block.id, "Definir série do gráfico", (b) => {
                        const curr = [...(b.options?.y_fields || [])];
                        if (curr.length === 0) {
                          curr.push(nextCol);
                        } else {
                          curr[idx] = nextCol;
                        }
                        return {
                          ...b,
                          options: {
                            ...b.options,
                            y_fields: curr.filter(Boolean),
                          },
                        };
                      })
                    }
                    onMove={(dir) =>
                      onUpdateBlock(block.id, "Reordenar séries do gráfico", (b) => {
                        const curr = [...(b.options?.y_fields || [])];
                        const target = idx + dir;
                        if (target < 0 || target >= curr.length) return b;
                        const [moved] = curr.splice(idx, 1);
                        curr.splice(target, 0, moved);
                        return {
                          ...b,
                          options: { ...b.options, y_fields: curr },
                        };
                      })
                    }
                    onRemove={() =>
                      onUpdateBlock(block.id, "Remover série do gráfico", (b) => {
                        const curr = [...(b.options?.y_fields || [])];
                        curr.splice(idx, 1);
                        return {
                          ...b,
                          options: {
                            ...b.options,
                            y_fields: curr.length > 0 ? curr : undefined,
                          },
                        };
                      })
                    }
                  />
                );
              })}
            </div>

            {block.type === "pie" ? (
              yFields.length >= 1 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <button
                    type="button"
                    className="cv-btn-compact"
                    onClick={() =>
                      setPieNotice(
                        "Gráfico de pizza aceita apenas 1 série de valores. Troque para Barras ou Linhas para comparar múltiplas séries.",
                      )
                    }
                  >
                    <Plus size={12} aria-hidden="true" />
                    Adicionar série
                  </button>
                </div>
              )
            ) : (
              yFields.length < 6 &&
              yFields.length >= 1 && (
                <button
                  type="button"
                  className="cv-btn-compact"
                  onClick={() => {
                    const nextCandidate = columnInfos.find(
                      (c) =>
                        !yFields.includes(c.name) &&
                        c.name !== xField &&
                        (opt.y_aggregate === "count" || isNumericCompatibleColumn(c)),
                    );
                    if (!nextCandidate) {
                      // Add duplicate of first or wait if no columns
                      const fallback = columnInfos.find((c) =>
                        opt.y_aggregate === "count" ? true : isNumericCompatibleColumn(c),
                      );
                      if (!fallback) return;
                      onUpdateBlock(block.id, "Adicionar série ao gráfico", (b) => ({
                        ...b,
                        options: {
                          ...b.options,
                          y_fields: [...(b.options?.y_fields || []), fallback.name].slice(0, 6),
                        },
                      }));
                      return;
                    }
                    onUpdateBlock(block.id, "Adicionar série ao gráfico", (b) => ({
                      ...b,
                      options: {
                        ...b.options,
                        y_fields: [...(b.options?.y_fields || []), nextCandidate.name].slice(0, 6),
                      },
                    }));
                  }}
                >
                  <Plus size={12} aria-hidden="true" />
                  Adicionar série
                </button>
              )
            )}
          </div>

          {/* Agregação Y */}
          <div className="cv-field">
            <label htmlFor="insp-chart-y-agg" className="cv-label">
              Agregação
            </label>
            <select
              id="insp-chart-y-agg"
              className="cv-input"
              disabled={previewUnavailable}
              title={previewUnavailable ? "Requer atualização do servidor" : undefined}
              value={opt.y_aggregate || (opt.x_group ? "sum" : "none")}
              onChange={(e) => {
                const raw = e.target.value;
                onUpdateBlock(block.id, "Alterar agregação do gráfico", (b) => ({
                  ...b,
                  options: {
                    ...b.options,
                    y_aggregate: raw === "none" ? undefined : (raw as ChartAggregateMode),
                  },
                }));
              }}
            >
              {!opt.x_group && <option value="none">Sem agregar (uma linha por ponto)</option>}
              <option value="sum">Soma</option>
              <option value="avg">Média</option>
              <option value="count">Contagem</option>
              <option value="min">Mínimo</option>
              <option value="max">Máximo</option>
            </select>
            {previewUnavailable && (
              <p className="cv-field-hint">Requer atualização do servidor.</p>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* 3. KPI: Valor, Agregação, Decimais e Exemplo */}
      {block.type === "kpi" && (
        <CollapsibleSection title="Indicador" defaultOpen={true}>
          <div className="cv-field">
            <span className="cv-label">Agregação</span>
            <SegmentedControl
              ariaLabel="Agregação do KPI"
              options={KPI_AGG_OPTIONS}
              value={(opt.aggregate || "sum") as AggregateMode}
              onChange={(nextAgg) =>
                onUpdateBlock(block.id, "Alterar agregação do indicador", (b) => ({
                  ...b,
                  options: { ...b.options, aggregate: nextAgg },
                }))
              }
            />
          </div>

          {(opt.aggregate ?? "sum") !== "count" && (
            <ColumnSelect
              id="insp-kpi-value"
              label="Valor"
              value={opt.value_field || ""}
              columns={columnInfos}
              onlyNumeric={true}
              placeholder="Escolher coluna numérica…"
              error={
                !opt.value_field && block.source_id
                  ? "Selecione uma coluna numérica para calcular o indicador."
                  : undefined
              }
              onChange={(colName) =>
                onUpdateBlock(block.id, "Selecionar coluna do indicador", (b) => ({
                  ...b,
                  options: { ...b.options, value_field: colName },
                }))
              }
            />
          )}

          <NumberField
            label="Casas decimais"
            value={opt.precision ?? 0}
            min={0}
            max={4}
            step={1}
            onChange={(val) =>
              onUpdateBlock(
                block.id,
                "Alterar casas decimais",
                (b) => ({
                  ...b,
                  options: { ...b.options, precision: Math.round(clamp(val, 0, 4)) },
                }),
                `precision:${block.id}`,
              )
            }
          />

          {kpiSample && (
            <div className="cv-field">
              <span className="cv-label">Resultado na prévia</span>
              <div className="cv-kpi-sample" aria-live="polite">
                {kpiSample}
              </div>
            </div>
          )}
        </CollapsibleSection>
      )}

      {/* 4. TABELA: Colunas, Larguras e Fonte */}
      {block.type === "table" && (
        <>
          <CollapsibleSection
            title="Colunas exibidas"
            defaultOpen={true}
            extra={
              <span className="cv-field-counter">
                {selectedTableCols.length}/{allColNames.length || selectedTableCols.length}
              </span>
            }
          >
            {orderedChecklistCols.length > 0 ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <button
                    type="button"
                    className="cv-btn-compact"
                    onClick={() =>
                      onUpdateBlock(block.id, "Selecionar todas as colunas", (b) => ({
                        ...b,
                        options: {
                          ...b.options,
                          columns: [...allColNames],
                          column_widths: b.options?.column_widths
                            ? adjustWidthsProportionally(
                                b.options.column_widths,
                                b.width,
                                allColNames.length,
                              )
                            : undefined,
                        },
                      }))
                    }
                  >
                    Todas
                  </button>
                  <button
                    type="button"
                    className="cv-btn-compact"
                    onClick={() =>
                      onUpdateBlock(block.id, "Desmarcar todas as colunas", (b) => ({
                        ...b,
                        options: {
                          ...b.options,
                          columns: [],
                          column_widths: undefined,
                        },
                      }))
                    }
                  >
                    Nenhuma
                  </button>
                </div>

                <div
                  id="insp-table-cols"
                  tabIndex={-1}
                  className="cv-table-col-list"
                  role="group"
                  aria-label="Colunas da tabela"
                >
                  {orderedChecklistCols.map((item) => {
                    const checkedIdx = selectedTableCols.indexOf(item.name);
                    const isMissing = columnInfos.length > 0 && !item.info;

                    const handleItemKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
                      if (!e.altKey || !item.checked) return;
                      if (e.key === "ArrowUp" && checkedIdx > 0) {
                        e.preventDefault();
                        e.stopPropagation();
                        moveTableCol(item.name, -1);
                      } else if (
                        e.key === "ArrowDown" &&
                        checkedIdx >= 0 &&
                        checkedIdx < selectedTableCols.length - 1
                      ) {
                        e.preventDefault();
                        e.stopPropagation();
                        moveTableCol(item.name, 1);
                      }
                    };

                    return (
                      <div
                        key={item.name}
                        className="cv-table-col-item"
                        draggable={item.checked}
                        onKeyDown={handleItemKeyDown}
                        onDragStart={(e: DragEvent<HTMLDivElement>) => {
                          if (!item.checked) return;
                          setDragColIdx(checkedIdx);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragOver={(e: DragEvent<HTMLDivElement>) => {
                          if (dragColIdx !== null && item.checked && dragColIdx !== checkedIdx) {
                            e.preventDefault();
                          }
                        }}
                        onDrop={(e: DragEvent<HTMLDivElement>) => {
                          e.preventDefault();
                          if (dragColIdx === null || !item.checked || dragColIdx === checkedIdx) {
                            setDragColIdx(null);
                            return;
                          }
                          const fromIdx = dragColIdx;
                          const toIdx = checkedIdx;
                          setDragColIdx(null);
                          onUpdateBlock(block.id, "Reordenar colunas da tabela", (b) => {
                            const curr = [...selectedTableCols];
                            const [moved] = curr.splice(fromIdx, 1);
                            curr.splice(toIdx, 0, moved);
                            return {
                              ...b,
                              options: { ...b.options, columns: curr },
                            };
                          });
                        }}
                        onDragEnd={() => setDragColIdx(null)}
                      >
                        <input
                          type="checkbox"
                          checked={item.checked}
                          aria-label={`Exibir coluna ${item.name}`}
                          onChange={(e) => {
                            const nextChecked = e.target.checked;
                            onUpdateBlock(block.id, "Configurar colunas da tabela", (b) => {
                              const nextCols = nextChecked
                                ? [...selectedTableCols, item.name]
                                : selectedTableCols.filter((c) => c !== item.name);
                              const nextWidths =
                                b.options?.column_widths && b.options.column_widths.length > 0
                                  ? nextCols.length > 0
                                    ? adjustWidthsProportionally(
                                        b.options.column_widths,
                                        b.width,
                                        nextCols.length,
                                      )
                                    : undefined
                                  : undefined;
                              return {
                                ...b,
                                options: {
                                  ...b.options,
                                  columns: nextCols,
                                  column_widths: nextWidths,
                                },
                              };
                            });
                          }}
                        />
                        <ColumnBadge
                          type={item.info?.type || "unknown"}
                          looksLike={item.info?.looks_like}
                        />
                        <span className="cv-table-col-name" title={item.name}>
                          {item.name}
                        </span>
                        {isMissing && <span className="cv-col-missing-tag">Ausente</span>}
                        {item.checked && selectedTableCols.length > 1 && (
                          <div className="cv-well-actions">
                            <button
                              type="button"
                              className="cv-well-btn"
                              disabled={checkedIdx <= 0}
                              title="Mover coluna para cima (Alt+↑)"
                              aria-label={`Mover coluna ${item.name} para cima`}
                              onClick={() => moveTableCol(item.name, -1)}
                            >
                              <ArrowUp size={11} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="cv-well-btn"
                              disabled={checkedIdx >= selectedTableCols.length - 1}
                              title="Mover coluna para baixo (Alt+↓)"
                              aria-label={`Mover coluna ${item.name} para baixo`}
                              onClick={() => moveTableCol(item.name, 1)}
                            >
                              <ArrowDown size={11} aria-hidden="true" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="cv-field-hint">
                Vincule uma fonte ou carregue a prévia na aba Dados para listar as colunas.
              </p>
            )}
          </CollapsibleSection>

          <CollapsibleSection title="Larguras e tipografia" defaultOpen={true}>
            <div className="cv-field">
              <div className="cv-field-top">
                <span className="cv-label">Modo de larguras</span>
                {isManualWidthMode && (
                  <span className="cv-field-counter">
                    {Math.round(widthSum)} / {Math.round(block.width)} px
                  </span>
                )}
              </div>
              <SegmentedControl
                ariaLabel="Modo de larguras das colunas"
                options={WIDTH_MODE_OPTIONS}
                value={isManualWidthMode ? "manual" : "auto"}
                disabled={selectedTableCols.length === 0}
                onChange={(mode) => {
                  if (mode === "auto") {
                    onColumnWidthsValidation(null);
                    onUpdateBlock(block.id, "Usar larguras automáticas", (b) => ({
                      ...b,
                      options: { ...b.options, column_widths: undefined },
                    }));
                  } else {
                    const count = Math.max(1, selectedTableCols.length);
                    const initial = adjustWidthsProportionally([], block.width, count);
                    onUpdateBlock(block.id, "Definir larguras manuais", (b) => ({
                      ...b,
                      options: { ...b.options, column_widths: initial },
                    }));
                  }
                }}
              />
            </div>

            {isManualWidthMode && (
              <div className="cv-field">
                {selectedTableCols.map((colName, idx) => {
                  const colW = manualWidths?.[idx] ?? Math.round(block.width / Math.max(1, selectedTableCols.length));
                  return (
                    <div key={`${colName}-${idx}`} className="cv-width-row">
                      <span className="cv-width-col-label" title={colName}>
                        {colName}
                      </span>
                      <NumberField
                        id={`insp-table-width-${idx}`}
                        ariaLabel={`Largura de ${colName}`}
                        value={colW}
                        min={1}
                        max={3000}
                        step={1}
                        unit="px"
                        onChange={(nextW) =>
                          onUpdateBlock(
                            block.id,
                            `Ajustar largura de ${colName}`,
                            (b) => {
                              const base = adjustWidthsProportionally(
                                b.options?.column_widths || [],
                                b.width,
                                selectedTableCols.length,
                              );
                              const updated = [...(b.options?.column_widths || base)];
                              while (updated.length < selectedTableCols.length) {
                                updated.push(base[updated.length] || 80);
                              }
                              updated[idx] = nextW;
                              return {
                                ...b,
                                options: {
                                  ...b.options,
                                  column_widths: updated.slice(0, selectedTableCols.length),
                                },
                              };
                            },
                            `col-w:${block.id}:${idx}`,
                          )
                        }
                      />
                    </div>
                  );
                })}

                {(widthExceedsBlock || widthCountMismatch) && (
                  <div className="cv-insp-problem is-error" role="alert">
                    <span className="cv-insp-problem-text">
                      {widthExceedsBlock
                        ? `Soma ${Math.round(widthSum)} > bloco ${Math.round(block.width)} px`
                        : `${manualWidths!.length} larguras para ${selectedTableCols.length} colunas`}
                    </span>
                    <button
                      type="button"
                      className="cv-insp-fix-btn"
                      onClick={() => {
                        onColumnWidthsValidation(null);
                        onUpdateBlock(block.id, "Ajustar larguras proporcionalmente", (b) => ({
                          ...b,
                          options: {
                            ...b.options,
                            column_widths: adjustWidthsProportionally(
                              b.options?.column_widths || [],
                              b.width,
                              Math.max(1, selectedTableCols.length),
                            ),
                          },
                        }));
                      }}
                    >
                      Ajustar proporcionalmente
                    </button>
                  </div>
                )}
              </div>
            )}

            <NumberField
              label="Tamanho da fonte"
              value={opt.font_size ?? 14}
              min={6}
              max={100}
              step={1}
              unit="px"
              onChange={(val) =>
                onUpdateBlock(
                  block.id,
                  "Alterar tamanho da fonte",
                  (b) => ({
                    ...b,
                    options: { ...b.options, font_size: clamp(val, 6, 100) },
                  }),
                  `font:${block.id}`,
                )
              }
            />
          </CollapsibleSection>
        </>
      )}
    </>
  );
}
