export interface ContextMenuItem {
  id: string;
  label: string;
  /** Shared icon name; the menu renders it through the icon service. */
  icon?: string;
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
