import Select from "./Select";
type Spec = {
  type?: string;
  order?: number;
  prompt?: string;
  not_before?: string;
  [key: string]: unknown;
};
export default function ReportParameterPrompts({
  value,
  onChange,
}: {
  value: string;
  onChange: (s: string) => void;
}) {
  let schema: Record<string, Spec>;
  try {
    schema = JSON.parse(value);
    if (!schema || Array.isArray(schema) || typeof schema !== "object")
      return null;
  } catch {
    return null;
  }
  const entries = Object.entries(schema).filter(
    ([, s]) => s && typeof s === "object",
  );
  if (!entries.length) return null;
  function update(key: string, patch: Partial<Spec>) {
    onChange(
      JSON.stringify(
        { ...schema, [key]: { ...schema[key], ...patch } },
        null,
        2,
      ),
    );
  }
  return (
    <fieldset className="report-prompt-fields">
      <legend>Solicitação dos parâmetros pelo WhatsApp</legend>
      {entries.map(([key, s], index) => (
        <div className="report-prompt-row" key={key}>
          <label className="op-field report-prompt-order">
            <span>Ordem</span>
            <input
              type="number"
              min={1}
              max={10000}
              value={s.order || index + 1}
              onChange={(e) => update(key, { order: Number(e.target.value) })}
            />
          </label>
          <label className="op-field">
            <span>
              {key}
              {s.type === "date" ? " · DD/MM/AAAA" : ""}
            </span>
            <input
              maxLength={1000}
              value={s.prompt || ""}
              placeholder={
                s.type === "date"
                  ? `Informe ${key} no formato DD/MM/AAAA.`
                  : `Informe ${key}.`
              }
              onChange={(e) => update(key, { prompt: e.target.value })}
            />
          </label>
          {s.type === "date" && (
            <label className="op-field">
              <span>Não anterior a</span>
              <Select
                value={s.not_before || ""}
                onChange={(e) => update(key, { not_before: e.target.value })}
              >
                <option value="">Sem restrição</option>
                {entries
                  .filter(([other, v]) => other !== key && v.type === "date")
                  .map(([other]) => (
                    <option key={other} value={other}>
                      {other}
                    </option>
                  ))}
              </Select>
            </label>
          )}
        </div>
      ))}
    </fieldset>
  );
}
