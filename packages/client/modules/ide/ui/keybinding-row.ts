import type { Keybinding } from "@projector-ai/core/modules/ide/index.ts";

export interface KeybindingRow {
  command: string;
  title: string;
  index: number;
  rule?: Keybinding;
  custom: boolean;
}
