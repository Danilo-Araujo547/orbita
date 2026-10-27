import Select from "./Select";
import { useState } from "react";
import FormAction from "./FormAction";
import type { CrossLayout, CrossTemplate } from "./CrossImportConfiguration";

type Props = {
  layouts: CrossLayout[];
  templates: CrossTemplate[];
  busy: boolean;
  act: (path: string, body: unknown) => Promise<unknown>;
};

export default function OracleAbsenceForm({ layouts, templates, busy, act }: Props) {
  const [date, setDate] = useState("");
  const [itemType, setItemType] = useState("ALL");
  const [layout, setLayout] = useState("");
  const [template, setTemplate] = useState("");
  const eligible = layouts.filter((item) => item.verified && item.format === "absence_html");
  const selected = eligible.find((item) => String(item.id) === layout);
  return (
    <FormAction title="Gerar ausentes pelo Oracle" label="Gerar ausentes" busy={busy}>
      <form className="op-card op-form" onSubmit={(event) => {
        event.preventDefault();
        void act("sheet-imports/oracle-absences", {
          absence_date: date, item_type: itemType, layout: Number(layout),
          ...(template ? { template: Number(template) } : {}),
        }).catch(() => {});
      }}>
        <label>Data da ausência
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </label>
        <label>Tipo de agendamento
          <Select value={itemType} onChange={(event) => setItemType(event.target.value)}>
            <option value="ALL">Todos</option>
            <option value="A">Consulta</option>
            <option value="I">Imagem / Exames</option>
            <option value="L">Laboratório</option>
          </Select>
        </label>
        <label>Modelo de ausentes
          <Select value={layout} onChange={(event) => {
            setLayout(event.target.value);
            const next = eligible.find((item) => String(item.id) === event.target.value);
            setTemplate(next?.default_template ? String(next.default_template) : "");
          }} required>
            <option value="">Selecione</option>
            {eligible.map((item) => <option key={item.id} value={item.id}>{item.name} · v{item.version}</option>)}
          </Select>
        </label>
        <label>Template
          <Select value={template} onChange={(event) => setTemplate(event.target.value)}>
            <option value="">{selected?.default_template ? "Padrão do modelo" : "Sem template"}</option>
            {templates.filter((item) => item.purpose === "absence").map((item) =>
              <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
        </label>
        <p className="op-muted">Sem atendimento vinculado · geração desativada para envio.</p>
        <button className="button primary" disabled={busy || !date || !layout}>Gerar agendamentos</button>
      </form>
    </FormAction>
  );
}
