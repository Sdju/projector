import { spawn } from "node:child_process";
import { join } from "node:path";

/**
 * Stops a process and everything it started with `taskkill /T /F`, bounded to two seconds. The
 * promise settles when taskkill is done, so callers that wait for exit do not race it. A Job
 * Object would also cover a crashed server, but needs a native addon; see docs/os.md.
 */
export function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const killer = spawn(
      join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
      ["/PID", String(pid), "/T", "/F"],
      {
        stdio: "ignore",
        windowsHide: true,
      },
    );
    const timer = setTimeout(() => {
      killer.kill();
      resolve();
    }, 2000);
    timer.unref();
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    killer.once("exit", done);
    killer.once("error", done);
  });
}
