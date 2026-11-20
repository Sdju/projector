import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { os } from "@ai-projector/core/modules/os/index.ts";

const nativeId = /^[\w-]+$/;

/** Resolves the directory once per answer. Kimi groups sessions under workspace directories. */
export function kimiBackgroundState(home = os.homeDirectory()) {
  let found: { session: string; directory: string } | undefined;
  return (session: string, task: string): { status: string; endedAt?: number } | undefined => {
    if (!nativeId.test(session) || !nativeId.test(task)) return;
    if (found?.session !== session) {
      const name = session.startsWith("session_") ? session : `session_${session}`;
      for (const config of [".kimi-code", ".kimi"]) {
        const root = join(home, config, "sessions");
        try {
          for (const workspace of readdirSync(root)) {
            const directory = join(root, workspace, name, "agents", "main", "tasks");
            if (!existsSync(directory)) continue;
            found = { session, directory };
            break;
          }
        } catch {
          // The legacy config or the workspace may be absent.
        }
        if (found?.session === session) break;
      }
    }
    if (found?.session !== session) return;
    try {
      const record = JSON.parse(readFileSync(join(found.directory, `${task}.json`), "utf8"));
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
      // Missing or temporarily incomplete while Kimi writes the record. Retry on the next poll.
    }
  };
}
