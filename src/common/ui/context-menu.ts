export interface ContextMenuItem {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  command?: string;
  args?: unknown;
  run: () => void | Promise<void>;
}
