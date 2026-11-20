import type { ClientAgent } from "../catalog/index.ts";
import { readKimiPlan } from "./plan.ts";
import KimiUsageIndicator from "./ui/KimiUsageIndicator.vue";

export { KimiUsageIndicator };

export const kimiAgent: ClientAgent = {
  backend: "kimi",
  program: "kimi",
  title: "Kimi",
  caption: "Запустит агента Kimi Code",
  icon: "simple-icons:kimi",
  usage: KimiUsageIndicator,
  usageUrl: "/api/kimi/usage",
  plan: readKimiPlan,
};
