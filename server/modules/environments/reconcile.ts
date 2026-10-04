import { os } from "../../../core/modules/os/index.ts";
import { loadProjects } from "../projects/index.ts";

const host = globalThis as typeof globalThis & { projectorReconciled?: boolean };
/** Names this server process: pid plus start time, so a reused pid is not mistaken for it. */
export const serverId = `${process.pid}-${os.processes.identity(process.pid) ?? "0"}`;

/** True while the process named by an owner label is still running. */
function ownerAlive(owner: string) {
  const match = /^(\d+)-(\d+)$/.exec(owner);
  if (!match) return undefined;
  return os.processes.identity(Number(match[1])) === match[2];
}

/**
 * Removes Projector's isolated-environment containers whose server process is gone
 * (SIGKILL, crash, power loss). A container is touched only if it carries Projector's
 * label AND its owner is provably dead or missing; containers of a live Projector
 * (another instance, a test server) and of unknown label formats are left alone.
 */
export async function reconcileEnvironmentContainers(
  contexts: string[],
  run: (args: string[]) => Promise<{ stdout: string }> = (args) => os.tools.runDocker(args),
) {
  let removed = 0;
  for (const context of new Set(contexts)) {
    try {
      const { stdout } = await run([
        "--context",
        context,
        "ps",
        "-a",
        "--filter",
        "label=io.projector.environment",
        "--format",
        '{{.ID}} {{.Label "io.projector.server"}}',
      ]);
      const orphans = stdout.split("\n").flatMap((line) => {
        const [id, owner = ""] = line.trim().split(" ");
        if (!/^[a-f0-9]{12,64}$/.test(id ?? "")) return [];
        if (owner === "") return [id]; // created before owners were recorded
        return ownerAlive(owner) === false ? [id] : [];
      });
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
