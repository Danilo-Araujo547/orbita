import { useState } from "react";
import type { DragEvent } from "react";
import {
  BarChart3,
  Hash,
  Image as ImageIcon,
  LineChart as LineChartIcon,
  PanelLeftClose,
  PieChart as PieChartIcon,
  Search,
  Table2,
  Type,
} from "lucide-react";
import type { BlockType } from "../model";
import { BLOCK_LABELS } from "../model";
import EmptyState from "../common/EmptyState";
import { DRAG_BLOCK_MIME } from "./structureOps";

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
  kpi: "KPI",
  table: "Tabela",
  bar: "Barras",
  line: "Linhas",
  pie: "Pizza",
  image: "Imagem",
};

const COMPONENT_DESCRIPTIONS: Record<BlockType, string> = {
  text: "Título, parágrafo ou variável",
  kpi: "Número com agregação",
  table: "Colunas da fonte em tabela",
  bar: "Comparação por categoria",
  line: "Evolução ao longo do tempo",
  pie: "Participação no total",
  image: "Logotipo ou figura do relatório",
};

const ORDERED_TYPES: readonly BlockType[] = [
  "text",
  "kpi",
  "table",
  "bar",
  "line",
  "pie",
  "image",
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
  onClosePanel?: () => void;
}

export default function BlockLibrary({
  active,
  loading,
  onAddComponent,
  onClosePanel,
}: BlockLibraryProps) {
  const [search, setSearch] = useState("");

  if (!active) return null;

  const queryNorm = normalizeSearch(search);
  const filteredTypes = ORDERED_TYPES.filter((type) => {
    if (!queryNorm) return true;
    const extra =
      type === "kpi"
        ? "indicador metrica"
        : type === "bar" || type === "line" || type === "pie"
          ? "grafico chart"
          : "";
    return normalizeSearch(
      `${COMPONENT_NAMES[type]} ${BLOCK_LABELS[type]} ${COMPONENT_DESCRIPTIONS[type]} ${extra}`,
    ).includes(queryNorm);
  });

  const handleDragStart = (event: DragEvent<HTMLButtonElement>, type: BlockType) => {
    event.dataTransfer.setData(DRAG_BLOCK_MIME, type);
    event.dataTransfer.setData("text/plain", type);
    event.dataTransfer.effectAllowed = "copy";
  };

  return (
    <section className="cv-panel" aria-label="Adicionar bloco">
      <header className="cv-panel-header">
        <h2>Adicionar</h2>
        {onClosePanel && (
          <div className="cv-panel-header-actions">
            <button
              type="button"
              className="cv-panel-icon-btn"
              aria-label="Recolher painel esquerdo"
              title="Recolher painel (Ctrl+\)"
              onClick={onClosePanel}
            >
              <PanelLeftClose size={15} aria-hidden="true" />
            </button>
          </div>
        )}
      </header>

      <div className="cv-panel-body">
        <label className="cv-search-field">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            aria-label="Buscar tipo de bloco"
            placeholder="Buscar tipo de bloco…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>

        {filteredTypes.length > 0 ? (
          <div className="cv-type-list" role="list">
            {filteredTypes.map((type) => {
              const Icon = COMPONENT_ICONS[type];
              return (
                <button
                  key={type}
                  type="button"
                  role="listitem"
                  draggable={!loading}
                  disabled={loading}
                  className="cv-type-row"
                  aria-label={`Adicionar ${COMPONENT_NAMES[type]}: ${COMPONENT_DESCRIPTIONS[type]}`}
                  title={`${COMPONENT_NAMES[type]} — clique para adicionar ou arraste para a folha`}
                  onDragStart={(e) => handleDragStart(e, type)}
                  onClick={() => onAddComponent(type)}
                >
                  <Icon className="cv-type-icon" size={16} strokeWidth={1.8} aria-hidden="true" />
                  <span className="cv-type-name">{COMPONENT_NAMES[type]}</span>
                  <span className="cv-type-desc">{COMPONENT_DESCRIPTIONS[type]}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <EmptyState
            compact={true}
            title="Nenhum bloco encontrado"
            description={`Nenhum tipo de bloco corresponde a "${search}".`}
            actionLabel="Limpar busca"
            onAction={() => setSearch("")}
          />
        )}
      </div>
    </section>
  );
}
