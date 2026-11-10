import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  addShebang,
  copy,
  emit,
  ensureAppBuild,
  root,
} from "../../../scripts/distribution/emit.mjs";

// Hub works without an installed IDE, so it keeps its own copy of the tunnel protocol from core.
// The package directory is the installation root: `app/main.ts` resolves the web build three
// levels up, so the emitted tree mirrors `packages/<name>/...` next to `dist/`.
const pkg = join(root, "packages/hub");
await ensureAppBuild();
for (const path of ["packages", "dist", "LICENSE"])
  await rm(join(pkg, path), { recursive: true, force: true });
// Emit hub first: its source directory is also the output parent, and core would otherwise
// already sit inside it as a generated sibling and get copied into the hub tree.
await emit(pkg, join(pkg, "packages/hub"));
await emit(join(root, "packages/core"), join(pkg, "packages/core"));
await copy("dist", join(pkg, "dist"));
await copy("LICENSE", join(pkg, "LICENSE"));
await addShebang(join(pkg, "packages/hub/app/main.js"));
console.log("@ai-projector/hub собран в packages/hub");
