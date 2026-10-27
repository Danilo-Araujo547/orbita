import { useMemo } from "react";
import InlineDialog from "../../InlineDialog";

export interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  action: string;
  keys: string[];
}

interface ShortcutCategory {
  category: string;
  items: ShortcutItem[];
}

export default function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps) {
  const isMac = useMemo(() => {
    return typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/i.test(navigator.platform);
  }, []);

  const modKey = isMac ? "⌘" : "Ctrl";

  const categories: ShortcutCategory[] = useMemo(
    () => [
      {
        category: "Seleção",
        items: [
          { action: "Selecionar bloco", keys: ["Clique"] },
          { action: "Limpar seleção", keys: ["Esc"] },
          { action: "Percorrer blocos (ordem de leitura)", keys: ["Tab"] },
          { action: "Percorrer blocos (ordem inversa)", keys: ["Shift", "Tab"] },
        ],
      },
      {
        category: "Edição",
        items: [
          { action: "Mover bloco 1 px", keys: ["Setas"] },
          { action: "Mover bloco 10 px", keys: ["Shift", "Setas"] },
          { action: "Duplicar bloco (+16 px)", keys: [modKey, "D"] },
          { action: "Excluir bloco", keys: ["Delete / Backspace"] },
          { action: "Trazer para frente", keys: [modKey, "]"] },
          { action: "Enviar para trás", keys: [modKey, "["] },
          { action: "Desfazer alteração", keys: [modKey, "Z"] },
          { action: "Refazer alteração", keys: [modKey, "Shift", "Z"] },
          { action: "Salvar relatório", keys: [modKey, "S"] },
          { action: "Desativar guias/encaixe durante o arraste", keys: ["Alt"] },
        ],
      },
      {
        category: "Visualização",
        items: [
          { action: "Aumentar zoom (+10 %)", keys: [modKey, "+"] },
          { action: "Reduzir zoom (-10 %)", keys: [modKey, "-"] },
          { action: "Zoom 100 %", keys: [modKey, "0"] },
          { action: "Ajustar à largura da página", keys: ["Shift", "1"] },
          { action: "Zoom com roda do mouse", keys: [modKey, "Roda"] },
          { action: "Mover pelo palco (pan)", keys: ["Espaço", "Arrastar"] },
        ],
      },
      {
        category: "Painéis e Ajuda",
        items: [
          { action: "Alternar painéis laterais", keys: [modKey, "\\"] },
          { action: "Abrir atalhos de teclado", keys: ["?"] },
        ],
      },
    ],
    [modKey],
  );

  if (!open) return null;

  return (
    <InlineDialog
      title="Atalhos de teclado"
      subtitle=""
      onClose={onClose}
      className="cv-root cv-dialog cv-shortcuts-dialog"
      footer={
        <button
          type="button"
          className="cv-btn"
          aria-label="Fechar diálogo de atalhos"
          onClick={onClose}
        >
          Fechar
        </button>
      }
    >
      <div className="cv-shortcuts-wrap">
        {categories.map((cat) => (
          <div key={cat.category} className="cv-shortcuts-group">
            <h4 className="cv-shortcuts-heading">{cat.category}</h4>
            <table className="cv-shortcuts-table">
              <tbody>
                {cat.items.map((item) => (
                  <tr key={item.action}>
                    <td className="cv-shortcuts-action">{item.action}</td>
                    <td className="cv-shortcuts-keys">
                      <div className="cv-kbd-row">
                        {item.keys.map((k, i) => (
                          <span key={i} className="cv-kbd-unit">
                            {i > 0 && item.keys.length > 1 && !k.startsWith("/") && (
                              <span className="cv-kbd-plus">+</span>
                            )}
                            <kbd className="cv-kbd">{k}</kbd>
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </InlineDialog>
  );
}
