import type { ClientAgent } from "../catalog/index.ts";
import AntigravitySkillSettings from "./ui/AntigravitySkillSettings.vue";
import AntigravityUsageIndicator from "./ui/AntigravityUsageIndicator.vue";

export { AntigravitySkillSettings, AntigravityUsageIndicator };

export const antigravityAgent: ClientAgent = {
  backend: "antigravity",
  program: "agy",
  title: "Antigravity",
  caption: "Запустит агента Antigravity (agy)",
  icon: "simple-icons:antigravity",
  // Manual-only indicator (no `usageUrl` so Analytics never polls `agy` automatically on mount).
  usage: AntigravityUsageIndicator,
  settings: AntigravitySkillSettings,
  settingsTitle: "навык для antigravity",
};
