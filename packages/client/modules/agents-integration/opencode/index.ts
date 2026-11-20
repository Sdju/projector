import type { ClientAgent } from "../catalog/index.ts";
import OpenCodeUsageIndicator from "./ui/OpenCodeUsageIndicator.vue";

export { OpenCodeUsageIndicator };

export const opencodeAgent: ClientAgent = {
  backend: "opencode",
  program: "opencode",
  title: "OpenCode",
  caption: "Запустит агента OpenCode",
  icon: "simple-icons:opencode",
  usage: OpenCodeUsageIndicator,
  usageUrl: "/api/opencode/usage",
};
