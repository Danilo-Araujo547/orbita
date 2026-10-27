import { useEffect } from "react";
import type { CanvasBlock } from "../model";
import type { ArrowKey } from "../stage/geometry";

export interface UseKeyboardShortcutsParams {
  selectedBlockId: string | null;
  blocks?: CanvasBlock[];
  modalOpen: boolean;
  onClearSelection?: () => void;
  onSelectBlock?: (blockId: string) => void;
  onDeleteBlock: (blockId: string) => void;
  onNudgeBlock: (blockId: string, key: ArrowKey, step: number) => void;
  onDuplicateBlock?: (blockId: string) => void;
  onReorderBlock?: (blockId: string, dir: -1 | 1) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onSave?: () => void;
  onTogglePanels?: () => void;
  onOpenShortcuts?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomReset?: () => void;
  onFitToWidth?: () => void;
}

const INTERACTIVE_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [role="combobox"], [role="listbox"], [data-select-popup]';

function isInteractiveElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable ||
    target.closest(INTERACTIVE_SELECTOR)
  ) {
    return true;
  }
  return false;
}

export function useKeyboardShortcuts({
  selectedBlockId,
  modalOpen,
  onClearSelection,
  onSelectBlock,
  onDeleteBlock,
  onNudgeBlock,
  onDuplicateBlock,
  onReorderBlock,
  onUndo,
  onRedo,
  onSave,
  onTogglePanels,
  onOpenShortcuts,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onFitToWidth,
}: UseKeyboardShortcutsParams) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement | null;
      const isInput = isInteractiveElement(target);

      if (modalOpen) return;

      // Only Ctrl+S is allowed inside inputs when focus is in the editor
      if (isInput) {
        if (isCmdOrCtrl && (e.key === "s" || e.key === "S")) {
          e.preventDefault();
          onSave?.();
        }
        return;
      }

      // Save: Ctrl+S
      if (isCmdOrCtrl && !e.shiftKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        onSave?.();
        return;
      }

      // Undo: Ctrl+Z
      if (isCmdOrCtrl && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        onUndo?.();
        return;
      }

      // Redo: Ctrl+Shift+Z or Ctrl+Y
      if (
        (isCmdOrCtrl && e.shiftKey && (e.key === "z" || e.key === "Z")) ||
        (isCmdOrCtrl && !e.shiftKey && (e.key === "y" || e.key === "Y"))
      ) {
        e.preventDefault();
        onRedo?.();
        return;
      }

      // Duplicate: Ctrl+D
      if (isCmdOrCtrl && !e.shiftKey && (e.key === "d" || e.key === "D")) {
        if (selectedBlockId) {
          e.preventDefault();
          onDuplicateBlock?.(selectedBlockId);
        }
        return;
      }

      // Layer ordering: Ctrl+] (forward) / Ctrl+[ (backward)
      if (isCmdOrCtrl && (e.key === "]" || e.key === "}")) {
        if (selectedBlockId) {
          e.preventDefault();
          onReorderBlock?.(selectedBlockId, 1);
        }
        return;
      }
      if (isCmdOrCtrl && (e.key === "[" || e.key === "{")) {
        if (selectedBlockId) {
          e.preventDefault();
          onReorderBlock?.(selectedBlockId, -1);
        }
        return;
      }

      // Toggle panels: Ctrl+\
      if (isCmdOrCtrl && e.key === "\\") {
        e.preventDefault();
        onTogglePanels?.();
        return;
      }

      // Open shortcuts dialog: ?
      if (!isCmdOrCtrl && !e.altKey && (e.key === "?" || (e.shiftKey && e.key === "/"))) {
        e.preventDefault();
        onOpenShortcuts?.();
        return;
      }

      // Zoom shortcuts: Ctrl+= / Ctrl++, Ctrl+-, Ctrl+0, Shift+1
      if (isCmdOrCtrl && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        onZoomIn?.();
        return;
      }
      if (isCmdOrCtrl && (e.key === "-" || e.key === "_")) {
        e.preventDefault();
        onZoomOut?.();
        return;
      }
      if (isCmdOrCtrl && e.key === "0") {
        e.preventDefault();
        onZoomReset?.();
        return;
      }
      if (e.shiftKey && !isCmdOrCtrl && e.key === "!") {
        // Shift+1 emits '!' on many layouts
        e.preventDefault();
        onFitToWidth?.();
        return;
      }

      // Escape: clear selection
      if (e.key === "Escape") {
        e.preventDefault();
        onClearSelection?.();
        return;
      }

      // Tab follows native document focus order; BlockFrame.onFocus selects
      // blocks without trapping focus or stealing Tab from toolbar buttons.

      // Delete / Backspace: delete selected block (without confirmation modal)
      if (selectedBlockId && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        onDeleteBlock(selectedBlockId);
        return;
      }

      // Arrow keys nudge: 1 px or 10 px with Shift
      if (
        selectedBlockId &&
        (e.key === "ArrowLeft" ||
          e.key === "ArrowRight" ||
          e.key === "ArrowUp" ||
          e.key === "ArrowDown")
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        onNudgeBlock(selectedBlockId, e.key, step);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    selectedBlockId,
    modalOpen,
    onClearSelection,
    onSelectBlock,
    onDeleteBlock,
    onNudgeBlock,
    onDuplicateBlock,
    onReorderBlock,
    onUndo,
    onRedo,
    onSave,
    onTogglePanels,
    onOpenShortcuts,
    onZoomIn,
    onZoomOut,
    onZoomReset,
    onFitToWidth,
  ]);
}
