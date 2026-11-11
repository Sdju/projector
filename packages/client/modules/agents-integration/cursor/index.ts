import IconCursor from "~icons/simple-icons/cursor";
import type { ClientAgent } from "../catalog/index.ts";
import { readCursorPlan } from "./plan.ts";

export const cursorAgent: ClientAgent = {
  backend: "cursor",
  program: "cursor",
  title: "Cursor",
  caption: "Запустит агента Cursor",
  icon: IconCursor,
  plugin: true,
  plan: readCursorPlan,
};
