import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { desktopPaths } from "./directories.ts";

/** macOS gets only the `projector` command; there is no GTK palette to put in a menu. */
export function installDesktop(root: string) {
  const launch = join(root, "cli", "app", "launch.mjs");
  const { bin } = desktopPaths();
  mkdirSync(bin, { recursive: true });
  const command = join(bin, "projector");
  const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
  writeFileSync(command, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(launch)} "$@"\n`);
  chmodSync(command, 0o755);
  console.log(`команда: ${command}`);
}
