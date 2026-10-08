import { createHash } from "node:crypto";
import { os } from "../../../core/modules/os/index.ts";
import type { TerminalActivity, TerminalSession } from "../../../core/modules/terminal/index.ts";

export const readTerminalProcesses = () => os.processes.snapshot();
export function terminalActivity(
  info: TerminalSession,
  processes: ReturnType<typeof readTerminalProcesses>,
): TerminalActivity {
  if (info.status === "exited") return { state: "idle", processes: [], confirmation: "" };
  const family = new Set([info.pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of processes ?? [])
      if (family.has(row.parent) && !family.has(row.pid)) {
        family.add(row.pid);
        changed = true;
      }
  }
  const rows = (processes ?? []).filter((row) => family.has(row.pid) && row.state !== "Z");
  const root = rows.find((row) => row.pid === info.pid);
  // Git's bin\bash.exe starts the real shell as a child of the same name. That chain is the
  // shell itself, not a command running in it.
  const launcher = new Set<number>([info.pid]);
  if (os.platform === "win32" && root)
    for (let found = true; found;) {
      found = false;
      for (const row of rows)
        if (!launcher.has(row.pid) && launcher.has(row.parent) && row.name === root.name) {
          launcher.add(row.pid);
          found = true;
        }
    }
  const children = rows.filter((row) => !launcher.has(row.pid));
  const shell =
    root &&
    ["bash", "sh", "zsh", "fish", "dash", "ksh", "powershell", "pwsh", "cmd"].includes(root.name);
  const state = !root
    ? "unknown"
    : children.length || info.commandId || info.program !== "shell" || !shell || root.state === "R"
      ? "busy"
      : (root.foreground === null || root.foreground === root.group) && root.state === "S"
        ? "idle"
        : "unknown";
  const work = children.length ? children : root ? [root] : [];
  const confirmation = createHash("sha256")
    .update(
      JSON.stringify({
        id: info.id,
        state,
        processes: rows
          .map((row) => [row.pid, row.started, row.name])
          .sort((a, b) => Number(a[0]) - Number(b[0])),
      }),
    )
    .digest("hex");
  return {
    state,
    processes: state === "idle" ? [] : work.map((row) => ({ pid: row.pid, name: row.name })),
    confirmation,
  };
}
