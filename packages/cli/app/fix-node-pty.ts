#!/usr/bin/env node
/**
 * node-pty 1.1.0 ships its macOS prebuild with a non-executable `spawn-helper`,
 * so `pty.fork` fails with `posix_spawnp failed`. npm and pnpm both keep the
 * mode from the tarball; make the helper executable after every install.
 */
import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

function packageRoots(): string[] {
  const roots: string[] = [];
  for (const base of [
    import.meta.url,
    pathToFileURL(join(ROOT, "packages/server/package.json")).href,
  ]) {
    try {
      roots.push(dirname(createRequire(base).resolve("node-pty/package.json")));
    } catch {
      // Not reachable from this package; the pnpm store fallback below finds it.
    }
  }
  const store = join(ROOT, "node_modules", ".pnpm");
  if (existsSync(store)) {
    for (const name of readdirSync(store)) {
      if (!name.startsWith("node-pty@")) continue;
      const root = join(store, name, "node_modules", "node-pty");
      if (existsSync(root)) roots.push(root);
    }
  }
  return [...new Set(roots)];
}

if (process.platform !== "win32") {
  for (const root of packageRoots()) {
    for (const helper of [
      join(root, "build", "Release", "spawn-helper"),
      join(root, "build", "Debug", "spawn-helper"),
      join(root, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
    ]) {
      if (!existsSync(helper)) continue;
      if ((statSync(helper).mode & 0o111) === 0o111) continue;
      chmodSync(helper, 0o755);
      console.log(`fix-node-pty: made ${helper} executable`);
    }
  }
}
