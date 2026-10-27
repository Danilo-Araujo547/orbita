import type { ReactNode } from "react";
import { Blocks, Database, Files, Image as ImageIcon, PanelLeftClose } from "lucide-react";
import type { LibraryTab } from "../hooks/usePersistedPrefs";

const RAIL_ITEMS = [
  { id: "components", label: "Componentes", short: "Blocos", Icon: Blocks },
  { id: "pages", label: "Páginas", short: "Páginas", Icon: Files },
  { id: "data", label: "Dados", short: "Dados", Icon: Database },
  { id: "images", label: "Imagens", short: "Imagens", Icon: ImageIcon },
] as const;

const HEADINGS: Record<LibraryTab, string> = {
  components: "Componentes",
  pages: "Páginas",
  data: "Dados",
  images: "Imagens",
};

export interface LeftRailProps {
  leftOpen: boolean;
  libraryTab: LibraryTab;
  onSelectLibrary: (tab: LibraryTab) => void;
  onCloseLeftPanel: () => void;
  children: ReactNode;
}

export default function LeftRail({
  leftOpen,
  libraryTab,
  onSelectLibrary,
  onCloseLeftPanel,
  children,
}: LeftRailProps) {
  return (
    <>
      <nav
        className="rc-studio-rail"
        aria-label="Painéis do editor"
        style={{ gridColumn: 1, gridRow: 1 }}
      >
        {RAIL_ITEMS.map((item) => (
          <button
            type="button"
            key={item.id}
            className="rc-rail-button"
            aria-label={item.label}
            title={item.label}
            aria-pressed={leftOpen && libraryTab === item.id}
            onClick={() => onSelectLibrary(item.id)}
          >
            <item.Icon size={22} />
            <span>{item.short}</span>
          </button>
        ))}
      </nav>
      <aside
        style={{ gridColumn: 2, gridRow: 1 }}
        hidden={!leftOpen}
        className="rc-sidebar rc-sidebar-left"
        aria-label="Biblioteca do editor"
      >
        <div className="rc-library-heading">
          <strong>{HEADINGS[libraryTab]}</strong>
          <button
            type="button"
            className="rc-icon-btn"
            aria-label="Recolher painel esquerdo"
            onClick={onCloseLeftPanel}
          >
            <PanelLeftClose size={17} />
          </button>
        </div>
        {children}
      </aside>
    </>
  );
}
