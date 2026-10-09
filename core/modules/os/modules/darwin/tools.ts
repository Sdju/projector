import { chmodSync, existsSync } from "node:fs";
import { lstat, rename } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { ptyCommand as posixPtyCommand } from "../../../os-posix/index.ts";
export {
  runDocker,
  runDockerSync,
  runNodeScript,
  runBash,
  commandExists,
  isExecutableFile,
  restrictToOwner,
  restrictToOwnerSync,
  runPython,
  searchFiles,
} from "../../../os-posix/index.ts";

/**
 * BSD `mv` has no `--no-target-directory`: a directory would be moved *into* an existing one.
 * An existing destination stays untouched and the source stays in place, as with GNU `mv`.
 */
export async function moveNoReplace(source: string, target: string) {
  const exists = await lstat(target).then(
    () => true,
    () => false,
  );
  if (!exists) await rename(source, target);
}

let helperChecked = false;
/** pnpm unpacks node-pty's prebuilt `spawn-helper` without the execute bit; spawning then fails. */
function ensurePtyHelper() {
  if (helperChecked) return;
  helperChecked = true;
  try {
    const root = dirname(createRequire(import.meta.url).resolve("node-pty/package.json"));
    const helper = join(root, "prebuilds", `darwin-${process.arch}`, "spawn-helper");
    if (existsSync(helper)) chmodSync(helper, 0o755);
  } catch {
    /* node-pty is built from source, or already usable. */
  }
}

export function ptyCommand(file: string, args: string[]) {
  ensurePtyHelper();
  return posixPtyCommand(file, args);
}
