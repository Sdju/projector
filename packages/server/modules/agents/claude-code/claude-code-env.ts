import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { agentEnv } from "../../agent/index.ts";

/**
 * Variables a running Claude Code session exports to everything it starts. A server launched from
 * such a session (`vp dev` typed by an agent) would hand them to every terminal and agent it
 * spawns: `claude` there takes itself for a nested child session and stops saving its transcript,
 * and the messaging socket/token of the parent session leak into unrelated shells.
 *
 * Only the session-bound names are listed. User settings such as `CLAUDE_CODE_USE_BEDROCK` or
 * `CLAUDE_CODE_OAUTH_TOKEN` are configuration, not session state, and stay.
 */
export const CLAUDE_SESSION_ENV = [
  "CLAUDECODE",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_AGENT_SDK_VERSION",
  "CLAUDE_PID",
] as const;

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
