import { spawn } from "node:child_process";

/** Separate stdio client: never restarts or detaches the user's Codex sessions. */
export function startCodexAppServer() {
  return spawn("codex", ["app-server", "--stdio"], {
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
    env: process.env,
  });
}
