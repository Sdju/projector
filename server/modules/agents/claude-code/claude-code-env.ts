import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { agentEnv } from "../../agent/index.ts";

/** The "Enabled by default" switch of Claude in Chrome, kept by the terminal in `~/.claude.json`. */
function chromeEnabledByDefault(): boolean {
  try {
    const config = JSON.parse(readFileSync(join(homedir(), ".claude.json"), "utf8"));
    return config?.claudeInChromeDefaultEnabled === true;
  } catch {
    return false;
  }
}

/**
 * The environment of a Claude Code session. The terminal connects `claude-in-chrome` on its own when
 * it is enabled by default; a session started through the SDK does so only when asked, so the same
 * setting is passed on as `CLAUDE_CODE_ENABLE_CFC`.
 */
export function claudeEnv(): Record<string, string | undefined> {
  const env = agentEnv();
  if (env.CLAUDE_CODE_ENABLE_CFC === undefined && chromeEnabledByDefault())
    env.CLAUDE_CODE_ENABLE_CFC = "1";
  return env;
}
