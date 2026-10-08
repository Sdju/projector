import { spawn } from "node:child_process";

/** Stops a process and everything it started. Fire and forget: taskkill is bounded to two seconds. */
export function killTree(pid: number): void {
  const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
  killer.unref();
  const timer = setTimeout(() => killer.kill(), 2000);
  timer.unref();
  killer.on("exit", () => clearTimeout(timer));
}
