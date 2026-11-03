import IconCodex from "~icons/simple-icons/openai";
import type { ClientAgent } from "../catalog/index.ts";
import CodexUsageIndicator from "./ui/CodexUsageIndicator.vue";

export { CodexUsageIndicator };

export const codexAgent: ClientAgent = {
  backend: "codex",
  program: "codex",
  title: "Codex",
  caption: "Запустит агента OpenAI Codex",
  icon: IconCodex,
  usage: CodexUsageIndicator,
};
