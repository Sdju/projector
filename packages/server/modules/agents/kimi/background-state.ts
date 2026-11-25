import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { os } from "@ai-projector/core/modules/os/index.ts";

const nativeId = /^[\w-]+$/;

/** Resolves Kimi's `agents/main` directory for a session across `.kimi-code` and `.kimi`. */
export function kimiMainAgentDirectory(
  session: string,
  home = os.homeDirectory(),
): string | undefined {
  if (!nativeId.test(session)) return undefined;
  const name = session.startsWith("session_") ? session : `session_${session}`;
  for (const config of [".kimi-code", ".kimi"]) {
    const root = join(home, config, "sessions");
    try {
      for (const workspace of readdirSync(root)) {
        const agentDir = join(root, workspace, name, "agents", "main");
        if (existsSync(agentDir)) return agentDir;
      }
    } catch {
      // The legacy config or the workspace may be absent.
    }
  }
  return undefined;
}

/** Reads the latest terminal status for `task` from Kimi 2.7+ `wire.jsonl` (`task.terminated`). */
function readWireTaskState(
  wirePath: string,
  task: string,
): { status: string; endedAt?: number } | undefined {
  let content: string;
  try {
    content = readFileSync(wirePath, "utf8");
  } catch {
    return undefined;
  }
  let result: { status: string; endedAt?: number } | undefined;
  for (const line of content.split("\n")) {
    if (!line.includes("task.terminated") || !line.includes(task)) continue;
    try {
      const record = JSON.parse(line) as {
        type?: unknown;
        info?: { kind?: unknown; taskId?: unknown; status?: unknown; endedAt?: unknown };
      };
      if (record.type !== "task.terminated") continue;
      const info = record.info;
      if (
        (info?.kind !== "agent" && info?.kind !== "process") ||
        info.taskId !== task ||
        typeof info.status !== "string"
      )
        continue;
      result = {
        status: info.status,
        ...(Number.isFinite(info.endedAt) ? { endedAt: info.endedAt as number } : {}),
      };
    } catch {
      // Incomplete trailing line while Kimi writes to wire.jsonl; retry on the next poll.
    }
  }
  return result;
}

/** Resolves the directory once per answer. Kimi groups sessions under workspace directories. */
export function kimiBackgroundState(home = os.homeDirectory()) {
  let found: { session: string; directory: string } | undefined;
  return (session: string, task: string): { status: string; endedAt?: number } | undefined => {
    if (!nativeId.test(session) || !nativeId.test(task)) return;
    if (found?.session !== session) {
      const directory = kimiMainAgentDirectory(session, home);
      if (directory) found = { session, directory };
    }
    if (found?.session !== session) return;
    const manifest = join(found.directory, "tasks", `${task}.json`);
    if (existsSync(manifest)) {
      try {
        const record = JSON.parse(readFileSync(manifest, "utf8"));
        // `agent` is a subagent; `process` is a Bash command detached by Kimi's tool timeout.
        if (
          (record?.kind !== "agent" && record?.kind !== "process") ||
          record.taskId !== task ||
          typeof record.status !== "string"
        )
          return;
        return {
          status: record.status,
          ...(Number.isFinite(record.endedAt) ? { endedAt: record.endedAt } : {}),
        };
      } catch {
        // Temporarily incomplete while Kimi writes the record. Retry on the next poll.
        return;
      }
    }
    return readWireTaskState(join(found.directory, "wire.jsonl"), task);
  };
}
