import { useEffect, useState } from "react";
import FormAction from "./FormAction";
import { query, request } from "../api";

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
    <fieldset className="cross-mapping">
      <legend>Planilha padronizada</legend>
      <div className="op-two">
        {standardFields.map((field, index) => (
          <label className="op-field" key={field}>
            <span>
              {index + 1}. {field}
            </span>
            <input
              value={mapping[field] || ""}
              placeholder="Coluna da origem"
              maxLength={200}
              onChange={(e) =>
                onChange({ ...mapping, [field]: e.target.value })
              }
            />
          </label>
        ))}
      </div>
    </fieldset>
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
  return (
    parameterCount(template) > 0 && (
      <fieldset className="cross-mapping">
        <legend>Parâmetros do template</legend>
        <div className="op-two">
          {Array.from({ length: parameterCount(template) }, (_, index) => (
            <label className="op-field" key={index}>
              <span>{`{{${index + 1}}}`}</span>
              <select
                required
                value={fields[index] || ""}
                onChange={(e) =>
                  onChange(
                    Array.from({ length: parameterCount(template) }, (_, i) =>
                      i === index ? e.target.value : fields[i] || "",
                    ),
                  )
                }
              >
                <option value="">Selecione</option>
                {standardFields.map((field) => (
                  <option key={field} value={field}>
                    {field}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </fieldset>
    )
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
      title={record ? "Nova versão do modelo" : "Novo modelo Importa CROSS"}
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
        <TemplateFields
          template={selected}
          fields={fields || suggestedParameters(selected)}
          onChange={setFields}
        />
        <MappingFields mapping={current} onChange={setMapping} />
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
  const [layoutId, setLayoutId] = useState(""),
    [templateId, setTemplateId] = useState(""),
    [fields, setFields] = useState<string[] | null>(null),
    [mapping, setMapping] = useState<Record<string, string> | null>(null),
    [file, setFile] = useState<File | null>(null),
    [localError, setLocalError] = useState("");
  const layout = layouts.find((l) => String(l.id) === layoutId),
    selected = templates.find((t) => String(t.id) === templateId);
  const current =
    mapping ||
    (layout?.standard_mapping && Object.keys(layout.standard_mapping).length
      ? layout.standard_mapping
      : schema?.default_mappings[layout?.format || "table"]) ||
    {};
  return (
    <FormAction
      title="Importar planilha"
      label="Importar planilha"
      busy={busy}
      error={localError || error}
    >
      <form
        className="op-form"
        onSubmit={(e) => {
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
              template: Number(templateId),
              parameter_fields: fields || suggestedParameters(selected),
              standard_mapping: current,
              filename: file.name,
              content_base64: btoa(binary),
            });
            setFile(null);
          })().catch((e) => setLocalError(e.message));
        }}
      >
        <div className="op-two">
          <label className="op-field">
            Modelo
            <select
              required
              value={layoutId}
              onChange={(e) => {
                const found = layouts.find(
                  (l) => String(l.id) === e.target.value,
                );
                setLayoutId(e.target.value);
                setTemplateId(String(found?.default_template || ""));
                setFields(
                  found?.parameter_fields?.length
                    ? found.parameter_fields
                    : null,
                );
                setMapping(null);
              }}
            >
              <option value="">Selecione</option>
              {layouts
                .filter((l) => l.verified)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
          </label>
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
                .filter((t) => compatible(t, layout?.format || "table"))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        {layout && (
          <>
            <TemplateFields
              template={selected}
              fields={fields || suggestedParameters(selected)}
              onChange={setFields}
            />
            <MappingFields mapping={current} onChange={setMapping} />
          </>
        )}
        <label className="op-field">
          Planilha
          <input
            type="file"
            required
            accept=".csv,.xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </label>
        <button
          className="button primary"
          disabled={busy || !schema || !layoutId || !templateId || !file}
        >
          Gerar prévia
        </button>
      </form>
    </FormAction>
  );
}
