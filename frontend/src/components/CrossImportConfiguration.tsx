import { useEffect, useRef, useState } from "react";
import type { DragEvent, FormEvent } from "react";
import FormAction from "./FormAction";
import { query, request } from "../api";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Layers,
  SlidersHorizontal,
  UploadCloud,
  X,
} from "lucide-react";

export const standardFields = [
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
] as const;

export const standardFieldLabels: Record<string, string> = {
  nome_completo: "Nome do paciente",
  data: "Data do agendamento",
  hora: "Horário",
  celular: "WhatsApp / Celular principal",
  celular2: "Celular secundário",
  tipo: "Procedimento / Especialidade",
  horario_chegada: "Horário de chegada",
  data_nascimento: "Data de nascimento",
  codigo: "Código / Prontuário",
  local: "Local / Sala / Unidade",
  tipo2: "Tipo de atendimento",
  obs: "Observações adicionais",
};

const aliases: Record<string, string> = {
  patient: "nome_completo",
  date: "data",
  arrival_time: "horario_chegada",
  phone: "celular",
  procedure: "tipo",
  external_id: "codigo",
  city: "local",
  source_observation: "obs",
  appointment_type: "tipo2",
};

export type CrossTemplate = {
  id: string | number;
  name?: string;
  fields?: string[];
  body?: string;
  purpose?: string;
};

export type CrossLayout = {
  id: string | number;
  name?: string;
  format?: string;
  verified?: boolean;
  evidence?: string;
  standard_mapping?: Record<string, string>;
  default_template?: number | null;
  parameter_fields?: string[];
  mapping?: Record<string, string>;
};

type Schema = {
  version: number;
  default_mappings: Record<string, Record<string, string>>;
};

type Act = (path: string, body: unknown) => Promise<unknown>;

export function parameterCount(template?: CrossTemplate) {
  if (!template) return 0;
  const positions = [...(template.body || "").matchAll(/{{\s*(\d+)\s*}}/g)].map(
    (match) => Number(match[1]),
  );
  return Math.min(
    30,
    positions.length ? Math.max(...positions) : template.fields?.length || 0,
  );
}

export function suggestedParameters(template?: CrossTemplate) {
  return Array.from({ length: parameterCount(template) }, (_, i) => {
    const field = template?.fields?.[i] || "";
    return standardFields.includes(field as (typeof standardFields)[number])
      ? field
      : aliases[field] || standardFields[i] || "";
  });
}

function compatible(template: CrossTemplate, format: string) {
  return format === "absence_html"
    ? template.purpose === "absence"
    : format === "cross_demand_csv"
      ? template.purpose === "waitlist"
      : ["waitlist", "summons"].includes(template.purpose || "");
}

function MappingFields({
  mapping,
  onChange,
}: {
  mapping: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  return (
    <div className="cross-mapping-grid">
      {standardFields.map((field, index) => (
        <div className="cross-mapping-item" key={field}>
          <div className="cross-mapping-label-row">
            <span className="cross-mapping-index">#{index + 1}</span>
            <span className="cross-mapping-field-name">{field}</span>
          </div>
          {standardFieldLabels[field] && (
            <span className="cross-mapping-field-hint">
              {standardFieldLabels[field]}
            </span>
          )}
          <input
            className="cross-mapping-input"
            value={mapping[field] || ""}
            placeholder="Coluna na planilha"
            maxLength={200}
            onChange={(e) =>
              onChange({ ...mapping, [field]: e.target.value })
            }
          />
        </div>
      ))}
    </div>
  );
}

function TemplateFields({
  template,
  fields,
  onChange,
}: {
  template?: CrossTemplate;
  fields: string[];
  onChange: (next: string[]) => void;
}) {
  const count = parameterCount(template);
  if (count <= 0) return null;
  return (
    <div className="cross-template-grid">
      {Array.from({ length: count }, (_, index) => (
        <div className="cross-template-item" key={index}>
          <div className="cross-template-tag">{`{{${index + 1}}}`}</div>
          <select
            required
            className="cross-template-select"
            value={fields[index] || ""}
            onChange={(e) =>
              onChange(
                Array.from({ length: count }, (_, i) =>
                  i === index ? e.target.value : fields[i] || "",
                ),
              )
            }
          >
            <option value="">Selecione o campo correspondente</option>
            {standardFields.map((field) => (
              <option key={field} value={field}>
                {field} {standardFieldLabels[field] ? `(${standardFieldLabels[field]})` : ""}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

function useSchema(unit: string) {
  const [schema, setSchema] = useState<Schema | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    request<Schema>(query("sheet-imports/schema", { unit }))
      .then((s) => active && setSchema(s))
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [unit]);
  return { schema, error };
}

export function CrossLayoutEditor({
  unit,
  templates,
  record,
  act,
  busy,
}: {
  unit: string;
  templates: CrossTemplate[];
  record?: CrossLayout;
  act: Act;
  busy: boolean;
}) {
  const { schema, error } = useSchema(unit);
  const [name, setName] = useState(record?.name || ""),
    [format, setFormat] = useState(record?.format || "table");
  const [mapping, setMapping] = useState<Record<string, string> | null>(
    record?.standard_mapping && Object.keys(record.standard_mapping).length
      ? record.standard_mapping
      : null,
  );
  const [reference, setReference] = useState(
      record?.mapping?.occurred_at || "",
    ),
    [templateId, setTemplateId] = useState(
      String(record?.default_template || ""),
    );
  const [fields, setFields] = useState<string[] | null>(
    record?.parameter_fields?.length ? record.parameter_fields : null,
  );
  const [evidence, setEvidence] = useState(record?.evidence || ""),
    [verified, setVerified] = useState(record?.verified || false);
  const selected = templates.find((t) => String(t.id) === templateId),
    current = mapping || schema?.default_mappings[format] || {};
  return (
    <FormAction
      title={record ? "Configurar modelo Importa CROSS" : "Novo modelo Importa CROSS"}
      label={record ? "Editar" : "Adicionar modelo"}
      busy={busy}
      error={error}
    >
      <form
        className="op-form"
        onSubmit={(e) => {
          e.preventDefault();
          void act("layouts", {
            name,
            format,
            standard_mapping: current,
            default_template: Number(templateId),
            parameter_fields: fields || suggestedParameters(selected),
            mapping:
              format === "table"
                ? {
                    external_id: current.codigo || "",
                    patient: current.nome_completo || "",
                    phone: current.celular || current.celular2 || "",
                    occurred_at: reference || current.data || "",
                  }
                : format === "cross_demand_csv"
                  ? { external_id: "Código", patient: "Nome", phone: "Telefone", occurred_at: "Data Entrada" }
                  : {},
            evidence,
            verified,
          }).catch(() => {});
        }}
      >
        <div className="op-two">
          <label className="op-field">
            Nome
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="op-field">
            Formato
            <select
              value={format}
              onChange={(e) => {
                setFormat(e.target.value);
                setMapping(null);
                setTemplateId("");
                setFields(null);
              }}
            >
              <option value="table">CSV / XLSX</option>
              <option value="absence_html">Ausentes HTML (.xls)</option>
              <option value="cross_demand_csv">
                Demanda por recurso CROSS (.csv)
              </option>
            </select>
          </label>
        </div>
        <label className="op-field">
          Template
          <select
            required
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value);
              setFields(null);
            }}
          >
            <option value="">Selecione</option>
            {templates
              .filter((t) => compatible(t, format))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </label>
        {selected && (
          <section className="op-card">
            <h3>Conteúdo do template</h3>
            <p style={{ whiteSpace: "pre-wrap" }}>{selected.body || "Sem conteúdo"}</p>
          </section>
        )}
        <div className="cross-mapping-subgroup">
          <h4 className="cross-mapping-subtitle">Parâmetros do template</h4>
          <TemplateFields
            template={selected}
            fields={fields || suggestedParameters(selected)}
            onChange={setFields}
          />
        </div>
        <div className="cross-mapping-subgroup">
          <h4 className="cross-mapping-subtitle">Mapeamento de colunas da planilha</h4>
          <MappingFields mapping={current} onChange={setMapping} />
        </div>
        {format === "table" && (
          <label className="op-field">
            Coluna da data de referência (se diferente de data)
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={200}
            />
          </label>
        )}
        <label className="op-field">
          Referência da validação
          <textarea
            required
            maxLength={4000}
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
          />
        </label>
        <label className="op-check">
          <input
            type="checkbox"
            checked={verified}
            onChange={(e) => setVerified(e.target.checked)}
          />
          Modelo validado
        </label>
        <button className="button primary" disabled={busy || !schema}>
          Salvar modelo
        </button>
      </form>
    </FormAction>
  );
}

export function CrossImportForm({
  unit,
  layouts,
  templates,
  act,
  busy,
}: {
  unit: string;
  layouts: CrossLayout[];
  templates: CrossTemplate[];
  act: Act;
  busy: boolean;
}) {
  const { schema, error } = useSchema(unit);
  const [layoutId, setLayoutId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const layout = layouts.find((l) => String(l.id) === layoutId);
  const selected = templates.find((t) => String(t.id) === templateId);
  const current =
    (layout?.standard_mapping && Object.keys(layout.standard_mapping).length
      ? layout.standard_mapping
      : schema?.default_mappings[layout?.format || "table"]) ||
    {};

  const mappedCount = Object.values(current).filter((val) => Boolean(val && val.trim())).length;

  const handleFileChange = (newFile: File | null) => {
    if (!newFile) {
      setFile(null);
      return;
    }
    if (newFile.size > 5 * 1024 * 1024) {
      setLocalError("O arquivo excede o limite máximo permitido de 5 MB.");
      return;
    }
    const ext = newFile.name.slice(newFile.name.lastIndexOf(".")).toLowerCase();
    if (![".csv", ".xlsx", ".xls"].includes(ext)) {
      setLocalError("Formato de arquivo não suportado. Utilize arquivos .xlsx, .xls ou .csv.");
      return;
    }
    setLocalError("");
    setFile(newFile);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatLayoutType = (fmt?: string) => {
    switch (fmt) {
      case "table":
        return "Tabela (CSV / XLSX)";
      case "absence_html":
        return "Ausentes HTML (.xls)";
      case "cross_demand_csv":
        return "Demanda por recurso CROSS (.csv)";
      default:
        return fmt || "Padrão";
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setLocalError("Arquivo excede 5 MB.");
      return;
    }
    setLocalError("");
    void (async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      await act("sheet-imports", {
        layout: Number(layoutId),
        filename: file.name,
        content_base64: btoa(binary),
      });
      setFile(null);
    })().catch((err: Error) => setLocalError(err.message));
  };

  return (
    <FormAction
      title="Importar planilha"
      label="Importar planilha"
      description="Carregue arquivos .xlsx ou .csv para validação e geração de prévia dos agendamentos"
      subtitleIcon={<FileSpreadsheet size={15} className="cross-title-icon" />}
      icon={<FileSpreadsheet size={15} />}
      busy={busy}
      error={localError || error}
      className="cross-import-modal"
    >
      <form className="op-form cross-import-form" onSubmit={handleSubmit}>
        {/* Seção 1: Configuração do Modelo e Template */}
        <div className="cross-section-card">
          <div className="cross-section-header">
            <Layers size={16} className="cross-section-icon" />
            <div className="cross-section-title-wrap">
              <span className="cross-section-title">1. Configuração da Importação</span>
              <span className="cross-section-subtitle">
                Selecione o modelo homologado e o template de mensagem vinculado
              </span>
            </div>
          </div>

          <div className="cross-two-fields">
            <div className="cross-field-wrapper">
              <label className="cross-field-label-text">
                Modelo homologado
              </label>
              <select
                required
                className="cross-select"
                value={layoutId}
                onChange={(e) => {
                  const found = layouts.find(
                    (l) => String(l.id) === e.target.value,
                  );
                  setLayoutId(e.target.value);
                  setTemplateId(String(found?.default_template || ""));

                }}
              >
                <option value="">Selecione um modelo</option>
                {layouts
                  .filter((l) => l.verified)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </select>
              {layout && (
                <div className="cross-field-tags">
                  <span className="cross-badge cross-badge-format">
                    {formatLayoutType(layout.format)}
                  </span>
                  <span className="cross-badge cross-badge-success">
                    <CheckCircle2 size={11} /> Homologado
                  </span>
                </div>
              )}
            </div>

            <div className="cross-field-wrapper">
              <label className="cross-field-label-text">
                Template de mensagem
              </label>
              <p>{selected?.name || "Não configurado"}</p>
              {selected && <p style={{ whiteSpace: "pre-wrap" }}>{selected.body}</p>}
              {layout && !selected && <p>Configure um template neste modelo antes de importar.</p>}

            </div>
          </div>
        </div>

        {/* Seção 2: Upload da Planilha */}
        <div className="cross-section-card">
          <div className="cross-section-header">
            <UploadCloud size={16} className="cross-section-icon" />
            <div className="cross-section-title-wrap">
              <span className="cross-section-title">2. Planilha de Dados</span>
              <span className="cross-section-subtitle">
                Envie o arquivo contendo os dados dos agendamentos (.xlsx, .xls ou .csv)
              </span>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            style={{ display: "none" }}
            onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
          />

          {!file ? (
            <div
              className={`cross-dropzone ${dragOver ? "drag-over" : ""}`}
              onDragEnter={handleDragOver}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
            >
              <div className="cross-dropzone-icon-wrap">
                <FileSpreadsheet size={32} />
              </div>
              <div className="cross-dropzone-texts">
                <p className="cross-dropzone-primary">
                  <strong>Arraste e solte o arquivo aqui</strong> ou <span className="cross-browse-link">procure no computador</span>
                </p>
                <p className="cross-dropzone-hint">
                  Formatos aceitos: Excel (.xlsx, .xls) ou CSV (.csv) • Máximo 5 MB
                </p>
              </div>
            </div>
          ) : (
            <div className="cross-file-preview-card">
              <div className="cross-file-preview-left">
                <div className="cross-file-icon-box">
                  <FileSpreadsheet size={24} />
                </div>
                <div className="cross-file-details">
                  <div className="cross-file-name" title={file.name}>
                    {file.name}
                  </div>
                  <div className="cross-file-meta">
                    <span className="cross-file-size">{formatFileSize(file.size)}</span>
                    <span className="cross-file-divider">•</span>
                    <span className="cross-file-status">
                      <CheckCircle2 size={12} /> Arquivo selecionado
                    </span>
                  </div>
                </div>
              </div>
              <div className="cross-file-actions">
                <button
                  type="button"
                  className="cross-file-action-btn cross-file-change-btn"
                  onClick={() => fileInputRef.current?.click()}
                  title="Substituir arquivo"
                >
                  Alterar
                </button>
                <button
                  type="button"
                  className="cross-file-action-btn cross-file-remove-btn"
                  onClick={() => setFile(null)}
                  title="Remover arquivo"
                  aria-label="Remover arquivo"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Seção 3: Mapeamento de Colunas e Parâmetros (Accordion) */}
        {layout && (
          <div className="cross-accordion-card">
            <button
              type="button"
              className={`cross-accordion-header ${showAdvanced ? "active" : ""}`}
              onClick={() => setShowAdvanced(!showAdvanced)}
              aria-expanded={showAdvanced}
            >
              <div className="cross-accordion-header-left">
                <SlidersHorizontal size={15} />
                <span className="cross-accordion-title">Mapeamento de colunas e parâmetros</span>
                <span className="cross-accordion-badge">
                  {mappedCount} campos mapeados
                </span>
              </div>
              <div className="cross-accordion-header-right">
                <span className="cross-accordion-hint">
                  {showAdvanced ? "Ocultar" : "Ver configuração"}
                </span>
                {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </div>
            </button>

            {showAdvanced && (
              <div className="cross-accordion-body">
                <div className="mapping-chips">
                  {(layout.parameter_fields || []).map((field, i) => (
                    <span className="mapping-chip" key={i}>{`{{${i + 1}}} → ${field}`}</span>
                  ))}
                  {Object.entries(current).filter(([, column]) => !!column).map(([field, column]) => (
                    <span className="mapping-chip" key={field}>{field}: {column}</span>
                  ))}
                </div>
                <p>Editar em Configurações → Importa CROSS · modelos e templates.</p>
              </div>
            )}
          </div>
        )}

        {/* Botão de envio (FormAction extrai para o footer) */}
        <button
          className="button primary cross-submit-action"
          disabled={busy || !schema || !layoutId || !layout?.default_template || !selected || !file}
        >
          <ArrowRight size={15} />
          <span>{busy ? "Processando..." : "Gerar prévia"}</span>
        </button>
      </form>
    </FormAction>
  );
}
