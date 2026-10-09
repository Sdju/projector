import { chmodSync, existsSync } from "node:fs";
import { lstat, mkdir, open, rename, rmdir, unlink } from "node:fs/promises";
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
 * BSD `mv` has no `--no-target-directory`. The destination is claimed atomically first (mkdir for
 * a directory, exclusive create for anything else) and `rename` then replaces the empty claim.
 * An existing destination stays untouched and the source stays in place, as with GNU `mv`.
 */
export async function moveNoReplace(source: string, target: string) {
  const directory = (await lstat(source)).isDirectory();
  try {
    if (directory) await mkdir(target);
    else await (await open(target, "wx")).close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return;
    throw error;
  }
  try {
    await rename(source, target);
  } catch (error) {
    await (directory ? rmdir(target) : unlink(target)).catch(() => {});
    throw error;
  }
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
