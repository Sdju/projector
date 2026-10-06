import type { Component } from "vue";

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: Component;
  shortcut?: string;
  /** Короткая метка справа (например, остаток лимита); `tone` красит её. */
  hint?: { text: string; tone?: "spare" | "normal" | "hot" | "over" | null };
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  command?: string;
  args?: unknown;
  run: () => void | Promise<void>;
}
