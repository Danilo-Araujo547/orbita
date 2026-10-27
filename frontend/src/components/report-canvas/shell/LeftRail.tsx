import { useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { Database, Image as ImageIcon, Layers, PlusSquare } from "lucide-react";
import type { LibraryTab } from "../hooks/usePersistedPrefs";

export const RAIL_ITEMS: ReadonlyArray<{
  id: LibraryTab;
  label: string;
  Icon: typeof PlusSquare;
}> = [
  { id: "components", label: "Adicionar", Icon: PlusSquare },
  { id: "pages", label: "Estrutura", Icon: Layers },
  { id: "data", label: "Dados", Icon: Database },
  { id: "images", label: "Imagens", Icon: ImageIcon },
];

export interface LeftRailProps {
  leftOpen: boolean;
  libraryTab: LibraryTab;
  onSelectLibrary: (tab: LibraryTab) => void;
  onOpenTab?: (tab: LibraryTab) => void;
  onCloseLeftPanel: () => void;
  children: ReactNode;
}

export default function LeftRail({
  leftOpen,
  libraryTab,
  onSelectLibrary,
  onOpenTab,
  children,
}: LeftRailProps) {
  const railRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    event.preventDefault();
    const currIdx = Math.max(
      0,
      RAIL_ITEMS.findIndex((item) => item.id === libraryTab),
    );
    let nextIdx = currIdx;
    if (event.key === "ArrowDown") nextIdx = (currIdx + 1) % RAIL_ITEMS.length;
    else if (event.key === "ArrowUp") nextIdx = (currIdx - 1 + RAIL_ITEMS.length) % RAIL_ITEMS.length;
    else if (event.key === "Home") nextIdx = 0;
    else if (event.key === "End") nextIdx = RAIL_ITEMS.length - 1;

    const nextItem = RAIL_ITEMS[nextIdx];
    if (nextItem) {
      if (onOpenTab) onOpenTab(nextItem.id);
      else onSelectLibrary(nextItem.id);
      const btns = railRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      btns?.[nextIdx]?.focus();
    }
  };

  return (
    <>
      <div
        ref={railRef}
        className="cv-rail"
        role="tablist"
        aria-orientation="vertical"
        aria-label="Painéis do editor"
        style={{ gridColumn: 1, gridRow: 1 }}
        onKeyDown={handleKeyDown}
      >
        {RAIL_ITEMS.map((item) => {
          const isSelected = leftOpen && libraryTab === item.id;
          const isTabStop = libraryTab === item.id;
          return (
            <button
              type="button"
              key={item.id}
              id={`cv-rail-tab-${item.id}`}
              role="tab"
              tabIndex={isTabStop ? 0 : -1}
              aria-selected={isSelected}
              aria-controls={`cv-left-panel-${item.id}`}
              aria-label={item.label}
              title={item.label}
              className="cv-rail-tab"
              onClick={() => onSelectLibrary(item.id)}
            >
              <item.Icon size={18} strokeWidth={1.8} aria-hidden="true" />
              <span className="cv-rail-tab-label">{item.label}</span>
            </button>
          );
        })}
      </div>

      <aside
        id={`cv-left-panel-${libraryTab}`}
        role="tabpanel"
        aria-labelledby={`cv-rail-tab-${libraryTab}`}
        style={{ gridColumn: 2, gridRow: 1 }}
        hidden={!leftOpen}
        className="cv-left-panel"
      >
        {children}
      </aside>
    </>
  );
}
