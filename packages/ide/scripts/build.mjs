import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  addShebang,
  copy,
  emit,
  ensureAppBuild,
  root,
} from "../../../scripts/distribution/emit.mjs";

// The IDE is the composition root: it physically contains core, server and CLI, so a single
// install has no internal packages and no version skew between them.
//
// The package directory is the installation root: CLI and server resolve `dist`, `resources`,
// `bin`, `packages/*` and `package.json` three levels up from their own module. Everything
// generated here is ignored by git; the tracked files are the manifest, README and scripts.
const pkg = join(root, "packages/ide");
await ensureAppBuild();
for (const path of ["packages", "dist", "resources", "bin", "LICENSE"])
  await rm(join(pkg, path), { recursive: true, force: true });
for (const name of ["core", "server", "cli"])
  await emit(join(root, "packages", name), join(pkg, "packages", name));
for (const path of ["dist", "resources", "bin", "LICENSE"]) await copy(path, join(pkg, path));
await addShebang(join(pkg, "packages/cli/app/launch.js"));
await addShebang(join(pkg, "packages/cli/app/install-desktop.js"));
console.log("@ai-projector/ide собран в packages/ide");
