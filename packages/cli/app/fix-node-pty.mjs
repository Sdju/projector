#!/usr/bin/env node
/**
 * node-pty 1.1.0 ships its macOS prebuild with a non-executable `spawn-helper`,
 * so `pty.fork` fails with `posix_spawnp failed`. npm and pnpm both keep the
 * mode from the tarball; make the helper executable after every install.
 */
import { chmodSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

if (process.platform !== "win32") {
  let root;
  try {
    root = dirname(createRequire(import.meta.url).resolve("node-pty/package.json"));
  } catch {
    process.exit(0);
  }
  for (const helper of [
    join(root, "build", "Release", "spawn-helper"),
    join(root, "build", "Debug", "spawn-helper"),
    join(root, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
  ]) {
    if (!existsSync(helper)) continue;
    chmodSync(helper, 0o755);
  }
}
