import IconKimi from "~icons/simple-icons/kimi";
import type { ClientAgent } from "../catalog/index.ts";
import KimiUsageIndicator from "./ui/KimiUsageIndicator.vue";

export { KimiUsageIndicator };

export const kimiAgent: ClientAgent = {
  backend: "kimi",
  program: "kimi",
  title: "Kimi",
  caption: "Запустит агента Kimi Code",
  icon: IconKimi,
  usage: KimiUsageIndicator,
};
