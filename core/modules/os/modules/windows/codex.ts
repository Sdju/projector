import { spawn } from "node:child_process";
import { commandExists } from "./tools.ts";

/** Separate stdio client: never restarts or detaches the user's Codex sessions. */
export function startCodexAppServer() {
  // npm installs codex as codex.cmd, which CreateProcess cannot start without a shell. A missing
  // binary is left to fail with ENOENT instead of a shell exit code.
  return spawn("codex", ["app-server", "--stdio"], {
    shell: commandExists("codex"),
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
    env: process.env,
  });
}
