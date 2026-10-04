import { randomUUID } from "node:crypto";
import { os } from "../../../core/modules/os/index.ts";
import { loadProjects } from "../projects/index.ts";

const host = globalThis as typeof globalThis & {
  projectorServerId?: string;
  projectorReconciled?: boolean;
};
/** Identifies this server process; HMR reloads keep it so live containers are not mistaken for orphans. */
export const serverId = (host.projectorServerId ??= randomUUID());

/**
 * Removes Projector's isolated-environment containers left by a previous server
 * (SIGKILL, crash, power loss). Only containers carrying Projector's label and
 * another process's id are touched; everything else on the daemon is ignored.
 */
export async function reconcileEnvironmentContainers(
  contexts: string[],
  run: (args: string[]) => Promise<{ stdout: string }> = (args) => os.tools.runDocker(args),
) {
  let removed = 0;
  for (const context of new Set(contexts)) {
    const ids = async (...filters: string[]) =>
      (
        await run(["--context", context, "ps", "-aq", ...filters.flatMap((f) => ["--filter", f])])
      ).stdout
        .split("\n")
        .filter((id) => /^[a-f0-9]{12,64}$/.test(id));
    try {
      const ours = new Set(
        await ids("label=io.projector.environment", `label=io.projector.server=${serverId}`),
      );
      const orphans = (await ids("label=io.projector.environment")).filter((id) => !ours.has(id));
      if (orphans.length) await run(["--context", context, "rm", "--force", ...orphans]);
      removed += orphans.length;
    } catch {
      /* Docker is not running for this context: nothing to clean. */
    }
  }
  return removed;
}

/** Once per server process, not per HMR reload. */
export async function reconcileOnStartup() {
  if (host.projectorReconciled) return;
  host.projectorReconciled = true;
  const contexts = (await loadProjects()).flatMap((project) =>
    project.environment ? [project.environment.context] : [],
  );
  const removed = await reconcileEnvironmentContainers(contexts);
  if (removed) console.log(`Удалено контейнеров от прошлого запуска Projector: ${removed}`);
}
