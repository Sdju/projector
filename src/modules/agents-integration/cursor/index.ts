import IconCursor from "~icons/simple-icons/cursor";
import type { ClientAgent } from "../catalog/index.ts";
import CursorUsageIndicator from "./ui/CursorUsageIndicator.vue";

export { CursorUsageIndicator };

export const cursorAgent: ClientAgent = {
  backend: "cursor",
  program: "cursor",
  title: "Cursor",
  caption: "Запустит агента Cursor",
  icon: IconCursor,
  usage: CursorUsageIndicator,
};
