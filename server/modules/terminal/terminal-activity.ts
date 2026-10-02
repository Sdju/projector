import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import type { TerminalActivity, TerminalSession } from "../../../core/modules/terminal/index.ts";

interface ProcessInfo {
  pid: number;
  parent: number;
  name: string;
  started: string;
  state: string;
  group: number;
  foreground: number;
}
export function readTerminalProcesses(): ProcessInfo[] | null {
  if (process.platform !== "linux") return null;
  try {
    return readdirSync("/proc")
      .filter((name) => /^\d+$/.test(name))
      .flatMap((name) => {
        try {
          const stat = readFileSync(`/proc/${name}/stat`, "utf8");
          const end = stat.lastIndexOf(")");
          const fields = stat.slice(end + 2).split(" ");
          return [
            {
              pid: Number(name),
              parent: Number(fields[1]),
              name: stat.slice(stat.indexOf("(") + 1, end),
              started: fields[19],
              state: fields[0],
              group: Number(fields[2]),
              foreground: Number(fields[5]),
            },
          ];
        } catch {
          return [];
        }
      });
  } catch {
    return null;
  }
}
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
  const children = rows.filter((row) => row.pid !== info.pid);
  const shell = root && ["bash", "sh", "zsh", "fish", "dash", "ksh"].includes(root.name);
  const state = !root
    ? "unknown"
    : children.length || info.commandId || info.program !== "shell" || !shell || root.state === "R"
      ? "busy"
      : root.foreground === root.group && root.state === "S"
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
