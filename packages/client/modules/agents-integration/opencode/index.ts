import IconOpenCode from "~icons/simple-icons/opencode";
import type { ClientAgent } from "../catalog/index.ts";
import OpenCodeUsageIndicator from "./ui/OpenCodeUsageIndicator.vue";

export { OpenCodeUsageIndicator };

export const opencodeAgent: ClientAgent = {
  backend: "opencode",
  program: "opencode",
  title: "OpenCode",
  caption: "Запустит агента OpenCode",
  icon: IconOpenCode,
  usage: OpenCodeUsageIndicator,
};
