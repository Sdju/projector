import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runDirectory } from "../../agent/index.ts";

/** Marker in a hosted run directory: after `end_turn` the ACP process must outlive the socket. */
export const ACP_KEEP_ALIVE = "keep-alive";

/** Ask `agent-host` to arm idle instead of SIGTERM when the server disconnects after a finished turn. */
export async function markAcpKeepAlive(runId: string): Promise<void> {
  await writeFile(join(runDirectory(runId), ACP_KEEP_ALIVE), "1\n", { mode: 0o600 });
}

/** Whether a run directory asked the host to keep the agent process after the turn. */
export function hasAcpKeepAlive(dir: string): boolean {
  return existsSync(join(dir, ACP_KEEP_ALIVE));
}
