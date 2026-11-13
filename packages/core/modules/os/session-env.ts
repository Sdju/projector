/**
 * Variables a parent coding-agent session exports to everything it starts. A server launched from
 * such a session would otherwise hand them to every terminal and agent it spawns.
 */
export const PARENT_SESSION_ENV = [
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

/** Removes the named variables from `env` in place and returns the names that were present. */
export function clearSessionEnv(
  names: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const removed: string[] = [];
  for (const name of names) {
    if (env[name] === undefined) continue;
    delete env[name];
    removed.push(name);
  }
  return removed;
}
