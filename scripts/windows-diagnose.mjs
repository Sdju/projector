// Prints what the Windows adapter resolves on this machine and whether a PTY can start.
import { spawn } from "node-pty";
import { os } from "../core/modules/os/index.ts";

const launch = os.shellLaunch({ kind: "interactive" });
console.log(JSON.stringify({ SHELL: process.env.SHELL, shell: os.shell(), launch }, null, 2));
for (const [file, args] of [
  [launch.file, launch.args],
  [launch.file, ["-c", "echo ok"]],
  ["powershell.exe", ["-NoLogo", "-Command", "echo ok"]],
]) {
  try {
    const child = spawn(file, args, { cols: 80, rows: 24, cwd: process.cwd(), env: process.env });
    child.onData((data) => process.stdout.write(`[${file}] ${data}`));
    await new Promise((resolve) => child.onExit(resolve));
    console.log(`\n${file}: started`);
  } catch (error) {
    console.log(`${file}: ${error.message}`);
  }
}
