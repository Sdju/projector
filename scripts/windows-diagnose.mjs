// Prints what the Windows adapter resolves on this machine and what a Git Bash PTY looks like
// while it runs a command.
import { spawn } from "node-pty";
import { os } from "../core/modules/os/index.ts";

const launch = os.shellLaunch({ kind: "interactive" });
console.log(JSON.stringify({ shell: os.shell(), launch }, null, 2));
const command = os.tools.ptyCommand(launch.file, launch.args);
const child = spawn(command.file, command.args, {
  cols: 80,
  rows: 24,
  cwd: process.cwd(),
  env: process.env,
});
let output = "";
child.onData((data) => (output += data));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await wait(4000);
child.write("sleep 20\r");
for (const delay of [1000, 3000, 6000]) {
  await wait(delay === 1000 ? 1000 : delay - (delay === 3000 ? 1000 : 3000));
  const rows = (await os.processes.list()) ?? [];
  const family = new Set([child.pid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const row of rows)
      if (family.has(row.parent) && !family.has(row.pid)) grew = !!family.add(row.pid);
  }
  console.log(
    `after ${delay}ms family:`,
    JSON.stringify(rows.filter((row) => family.has(row.pid)).map((r) => [r.pid, r.parent, r.name])),
    "sleep anywhere:",
    JSON.stringify(
      rows.filter((row) => /sleep/.test(row.name)).map((r) => [r.pid, r.parent, r.name]),
    ),
  );
}
console.log("terminal tail:", JSON.stringify(output.slice(-300)));
child.kill();
process.exit(0);
