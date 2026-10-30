import IconClaude from "~icons/simple-icons/claude";
import type { ClientAgent } from "../catalog/index.ts";
import ClaudeUsageIndicator from "./ui/ClaudeUsageIndicator.vue";

export { ClaudeUsageIndicator };

export const claudeAgent: ClientAgent = {
  backend: "claude-code",
  program: "claude",
  title: "Claude Code",
  caption: "Запустит агента Anthropic",
  icon: IconClaude,
  usage: ClaudeUsageIndicator,
};
