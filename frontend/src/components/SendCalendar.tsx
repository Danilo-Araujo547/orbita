import Select from "./Select";
export const weekdayNames = [
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
  "Domingo",
];
const shortDays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
export type DayPolicy = Record<string, "previous" | "next">;
export function shiftedDay(
  day: number,
  allowed: number[],
  direction: "previous" | "next",
) {
  const step = direction === "previous" ? -1 : 1;
  for (let count = 1; count < 7; count++) {
    const target = (day + step * count + 7) % 7;
    if (allowed.includes(target)) return { target, offset: step * count };
  }
  return { target: day, offset: 0 };
}
const presets = [
  {
    id: "all",
    label: "Todos os dias",
    days: [0, 1, 2, 3, 4, 5, 6],
    policy: {},
  },
  {
    id: "fri",
    label: "Segunda a sexta · fim de semana na sexta",
    days: [0, 1, 2, 3, 4],
    policy: { "5": "previous", "6": "previous" },
  },
  {
    id: "mon",
    label: "Segunda a sexta · fim de semana na segunda",
    days: [0, 1, 2, 3, 4],
    policy: { "5": "next", "6": "next" },
  },
  {
    id: "split",
    label: "Segunda a sexta · sábado na sexta, domingo na segunda",
    days: [0, 1, 2, 3, 4],
    policy: { "5": "previous", "6": "next" },
  },
  {
    id: "sat",
    label: "Segunda a sábado · domingo no sábado",
    days: [0, 1, 2, 3, 4, 5],
    policy: { "6": "previous" },
  },
] as const;
export default function SendCalendar({
  days,
  policy,
  onChange,
}: {
  days: number[];
  policy: DayPolicy;
  onChange: (days: number[], policy: DayPolicy) => void;
}) {
  const blocked = weekdayNames
    .map((_, d) => d)
    .filter((d) => !days.includes(d));
  const selected =
    presets.find(
      (p) =>
        p.days.length === days.length &&
        p.days.every((d) => days.includes(d)) &&
        blocked.every(
          (d) =>
            (policy[String(d)] || "previous") ===
            (p.policy as DayPolicy)[String(d)],
        ),
    )?.id || "custom";
  return (
    <div className="send-calendar">
      <label className="op-field">
        <span>Calendário de envios</span>
        <Select
          value={selected}
          onChange={(e) => {
            const p = presets.find((p) => p.id === e.target.value);
            if (p) onChange([...p.days], { ...p.policy });
          }}
        >
          <option value="custom">Personalizado</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </label>
      <div
        className="send-calendar-days"
        role="group"
        aria-label="Dias permitidos para envio"
      >
        {shortDays.map((label, day) => (
          <button
            key={day}
            type="button"
            className={
              "send-calendar-day" + (days.includes(day) ? " selected" : "")
            }
            aria-label={weekdayNames[day]}
            aria-pressed={days.includes(day)}
            disabled={days.length === 1 && days.includes(day)}
            onClick={() => {
              const next = days.includes(day)
                ? days.filter((d) => d !== day)
                : [...days, day].sort();
              onChange(next, policy);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {!!blocked.length && (
        <div className="send-calendar-adjustments">
          <h4>Quando cair em um dia bloqueado</h4>
          {blocked.map((day) => (
            <div className="send-calendar-row" key={day}>
              <strong>{weekdayNames[day]}</strong>
              <label className="op-field">
                <span className="sr-only">Ajuste para {weekdayNames[day]}</span>
                <Select
                  aria-label={"Ajuste para " + weekdayNames[day]}
                  value={policy[String(day)] || "previous"}
                  onChange={(e) =>
                    onChange(days, {
                      ...policy,
                      [String(day)]: e.target.value as "previous" | "next",
                    })
                  }
                >
                  {(["previous", "next"] as const).map((direction) => {
                    const { target, offset } = shiftedDay(day, days, direction);
                    return (
                      <option key={direction} value={direction}>
                        {direction === "previous"
                          ? "Antecipar para "
                          : "Adiar para "}
                        {weekdayNames[target].toLowerCase()} ·{" "}
                        {Math.abs(offset)}{" "}
                        {Math.abs(offset) === 1 ? "dia" : "dias"}
                      </option>
                    );
                  })}
                </Select>
              </label>
            </div>
          ))}
        </div>
      )}
      <div className="send-calendar-preview" aria-label="Prévia semanal">
        {shortDays.map((label, day) => {
          const enabled = days.includes(day);
          const { target } = enabled
            ? { target: day }
            : shiftedDay(day, days, policy[String(day)] || "previous");
          return (
            <div key={day} className={enabled ? "" : "adjusted"}>
              <span>{label}</span>
              <strong>{enabled ? "Mantém" : "→ " + shortDays[target]}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}
