/**
 * Variables a running Claude Code session exports to everything it starts. A server launched from
 * such a session (`vp dev` typed by an agent) would hand them to every terminal and agent it
 * spawns: `claude` there takes itself for a nested child session and stops saving its transcript,
 * and the messaging socket/token of the parent session leak into unrelated shells.
 *
 * Only the session-bound names are listed. User settings such as `CLAUDE_CODE_USE_BEDROCK` or
 * `CLAUDE_CODE_OAUTH_TOKEN` are configuration, not session state, and stay.
 */
export const AGENT_SESSION_ENV = [
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

/** Removes the inherited session markers in place and returns the names that were present. */
export function clearAgentSession(env: NodeJS.ProcessEnv = process.env): string[] {
  const removed: string[] = [];
  for (const name of AGENT_SESSION_ENV) {
    if (env[name] === undefined) continue;
    delete env[name];
    removed.push(name);
  }
  return removed;
}
