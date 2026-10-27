import { useEffect } from "react";
import type { ArrowKey } from "../stage/geometry";

export interface UseKeyboardShortcutsParams {
  selectedBlockId: string | null;
  modalOpen: boolean;
  onDeleteBlock: (blockId: string) => void;
  onNudgeBlock: (blockId: string, key: ArrowKey, step: number) => void;
  // Stub para Tarefa 06 (atalhos de desfazer/refazer/duplicar/etc.)
  onUndo?: () => void;
  onRedo?: () => void;
}

const INTERACTIVE_SELECTOR =
  'button, input, textarea, select, [role="combobox"], [role="listbox"], [data-select-popup], [contenteditable="true"]';

export function useKeyboardShortcuts({
  selectedBlockId,
  modalOpen,
  onDeleteBlock,
  onNudgeBlock,
}: UseKeyboardShortcutsParams) {
  useEffect(() => {
    if (!selectedBlockId || modalOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable ||
          target.closest(INTERACTIVE_SELECTOR))
      ) {
        return;
      }
      if (e.key === "Delete") {
        e.preventDefault();
        onDeleteBlock(selectedBlockId!);
        return;
      }
      if (
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown"
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        onNudgeBlock(selectedBlockId!, e.key, step);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedBlockId, modalOpen, onDeleteBlock, onNudgeBlock]);
}
