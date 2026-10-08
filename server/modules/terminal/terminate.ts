import type { IPty } from "node-pty";
import { os } from "../../../core/modules/os/index.ts";

// Only the POSIX branch below uses these: it must list the family before the shell exits.
const descendants = (pid: number) => os.processes.descendantsSync(pid);

/** Ends a PTY and everything its shell started: SIGTERM first, SIGKILL after a grace period. */
export function terminateProcessTree(pty: IPty, immediate: boolean): void {
  if (os.platform === "win32") {
    // pty.kill() is not used here: node-pty's version attaches to the console of that pid and
    // kills everything listed, which hits unrelated programs once the pid has been reused.
    // Ending the tree closes the pseudo console on its own.
    const killRoot = () => os.tools.killAgentTree(pty.pid);
    // While the process exits there is no time to look around: the root tree is all we can end.
    if (immediate) return killRoot();
    // MSYS programs are not Win32 children of their shell; the tracked console lists them, but
    // only a young listing is trusted: an old one could name pids that have been reused.
    const rows = os.processes.recent(2500) ?? [];
    const family = new Set([pty.pid]);
    for (let grew = true; grew;) {
      grew = false;
      for (const row of rows)
        if (family.has(row.parent) && !family.has(row.pid)) grew = !!family.add(row.pid);
    }
    for (const pid of family) if (pid !== pty.pid) os.tools.killAgentTree(pid);
    killRoot();
    return;
  }
  const family = descendants(pty.pid);
  for (const entry of family.reverse()) {
    try {
      os.processes.signal(entry.pid, immediate ? "SIGKILL" : "SIGTERM");
    } catch {
      /* Already exited. */
    }
  }
  try {
    pty.kill(immediate ? "SIGKILL" : "SIGTERM");
  } catch {
    /* Already exited. */
  }
  if (immediate) return;
  const timer = setTimeout(async () => {
    for (const entry of family) {
      try {
        if ((await os.processes.identity(entry.pid)) === entry.started) {
          for (const child of descendants(entry.pid).reverse()) {
            try {
              os.processes.signal(child.pid, "SIGKILL");
            } catch {
              /* Already exited. */
            }
          }
          os.processes.signal(entry.pid, "SIGKILL");
        }
      } catch {
        /* Already exited; never kill a reused pid. */
      }
    }
  }, 1500);
  timer.unref();
}
