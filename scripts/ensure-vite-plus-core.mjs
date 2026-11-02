#!/usr/bin/env node
/**
 * pnpm sometimes links an incomplete @voidzero-dev/vite-plus-core (bin/vite.js missing).
 * Without it `vp dev` dies immediately and Start Menu launch looks like a no-op.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  cpSync,
  createWriteStream,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(join(ROOT, "package.json"));

function catalogVersion() {
  const workspace = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8");
  const match = workspace.match(/vite:\s*npm:@voidzero-dev\/vite-plus-core@([^\s]+)/);
  return match?.[1] ?? "1.4.0";
}

function tarballUrl() {
  const version = catalogVersion();
  return `https://registry.npmjs.org/@voidzero-dev/vite-plus-core/-/vite-plus-core-${version}.tgz`;
}

function cliPath(pkgRoot) {
  return join(pkgRoot, "dist", "vite", "bin", "vite.js");
}

function isVitePlusCore(pkgRoot) {
  try {
    return (
      JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")).name ===
      "@voidzero-dev/vite-plus-core"
    );
  } catch {
    return false;
  }
}

function packageRoots() {
  const roots = [];
  for (const dir of [
    join(ROOT, "node_modules", "@voidzero-dev", "vite-plus-core"),
    // pnpm catalog aliases the package as `vite`.
    join(ROOT, "node_modules", "vite"),
  ]) {
    if (isVitePlusCore(dir)) roots.push(dir);
  }
  const store = join(ROOT, "node_modules", ".pnpm");
  if (!existsSync(store)) return roots;
  for (const name of readdirSync(store)) {
    if (!name.startsWith("@voidzero-dev+vite-plus-cor")) continue;
    const pkg = join(store, name, "node_modules", "@voidzero-dev", "vite-plus-core");
    if (existsSync(pkg)) roots.push(pkg);
  }
  return roots;
}

function matchingRoots() {
  const version = catalogVersion();
  return packageRoots().filter((root) => {
    try {
      return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version === version;
    } catch {
      return false;
    }
  });
}

function present() {
  return matchingRoots().some((root) => existsSync(cliPath(root)));
}

function resolveTar() {
  try {
    return require("tar");
  } catch {
    // Nested under pnpm; walk store for a usable copy.
    const store = join(ROOT, "node_modules", ".pnpm");
    if (!existsSync(store)) return null;
    for (const name of readdirSync(store)) {
      if (!name.startsWith("tar@")) continue;
      const entry = join(store, name, "node_modules", "tar");
      if (existsSync(join(entry, "package.json"))) {
        return createRequire(join(entry, "package.json"))("tar");
      }
    }
    return null;
  }
}

async function downloadTarball(dest) {
  const url = tarballUrl();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download ${url} ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(dest));
}

async function repair() {
  const roots = matchingRoots();
  if (!roots.length) {
    console.error("ensure-vite-plus-core: пакет не установлен, сначала pnpm install");
    return false;
  }
  const tar = resolveTar();
  if (!tar) {
    console.error("ensure-vite-plus-core: модуль tar недоступен");
    return false;
  }
  const staging = mkdtempSync(join(tmpdir(), "projector-vpcore-"));
  try {
    const tgz = join(staging, "vite-plus-core.tgz");
    // Fetch outside the project so npm's package.json engines/devEngines do not apply.
    await downloadTarball(tgz);
    const extract = join(staging, "out");
    mkdirSync(extract);
    await tar.x({ file: tgz, cwd: extract });
    const dist = join(extract, "package", "dist");
    if (!existsSync(join(dist, "vite", "bin", "vite.js"))) return false;
    for (const root of roots) {
      mkdirSync(dirname(cliPath(root)), { recursive: true });
      cpSync(dist, join(root, "dist"), { recursive: true });
      console.log(`ensure-vite-plus-core: восстановлен ${cliPath(root)}`);
    }
    return present();
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

if (present()) {
  console.log("ensure-vite-plus-core: ok");
  process.exit(0);
}

console.warn("ensure-vite-plus-core: нет bin/vite.js, восстанавливаю из npm…");
const ok = await repair();
if (!ok) {
  console.error("ensure-vite-plus-core: не удалось восстановить. Выполните pnpm install");
  process.exit(1);
}
