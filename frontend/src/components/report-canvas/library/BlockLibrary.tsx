import { useState } from "react";
import {
  BarChart3,
  Hash,
  Image as ImageIcon,
  LineChart as LineChartIcon,
  PieChart as PieChartIcon,
  Search,
  Table2,
  Type,
} from "lucide-react";
import type { BlockType } from "../model";
import { BLOCK_LABELS } from "../model";

export const COMPONENT_ICONS = {
  text: Type,
  kpi: Hash,
  table: Table2,
  bar: BarChart3,
  line: LineChartIcon,
  pie: PieChartIcon,
  image: ImageIcon,
} as const;

export const COMPONENT_NAMES: Record<BlockType, string> = {
  text: "Texto",
  kpi: "Indicador",
  table: "Tabela",
  bar: "Barras",
  line: "Linhas",
  pie: "Pizza",
  image: "Imagem",
};

const GROUPS: ReadonlyArray<{ title: string; types: readonly BlockType[] }> = [
  { title: "Conteúdo", types: ["text", "kpi", "table", "image"] },
  { title: "Gráficos", types: ["bar", "line", "pie"] },
];

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

export interface BlockLibraryProps {
  active: boolean;
  loading: boolean;
  onAddComponent: (type: BlockType) => void;
}

export default function BlockLibrary({ active, loading, onAddComponent }: BlockLibraryProps) {
  const [componentSearch, setComponentSearch] = useState("");

  if (!active) return null;

  const queryNorm = normalizeSearch(componentSearch);
  const matchesComponent = (type: BlockType) =>
    normalizeSearch(
      `${COMPONENT_NAMES[type]} ${BLOCK_LABELS[type]} ${
        ["bar", "line", "pie"].includes(type) ? "Gráfico" : ""
      }`,
    ).includes(queryNorm);

  const anyMatch = (Object.keys(COMPONENT_NAMES) as BlockType[]).some(matchesComponent);

  return (
    <section className="rc-library-panel">
      <label className="rc-library-search">
        <Search size={16} />
        <input
          aria-label="Buscar componente"
          placeholder="Buscar componente"
          value={componentSearch}
          onChange={(e) => setComponentSearch(e.target.value)}
        />
      </label>
      {GROUPS.map((group) => {
        const types = group.types.filter(matchesComponent);
        return types.length ? (
          <div key={group.title}>
            <h3 className="rc-library-group-title">{group.title}</h3>
            <div className="rc-component-grid">
              {types.map((type) => {
                const Icon = COMPONENT_ICONS[type];
                return (
                  <button
                    key={type}
                    type="button"
                    className="rc-component-tile"
                    disabled={loading}
                    onClick={() => onAddComponent(type)}
                  >
                    <span className="rc-component-symbol">
                      <Icon size={30} strokeWidth={1.6} />
                    </span>
                    <span>{COMPONENT_NAMES[type]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null;
      })}
      {!anyMatch && <p className="rc-empty-note">Nenhum componente encontrado.</p>}
    </section>
  );
}
