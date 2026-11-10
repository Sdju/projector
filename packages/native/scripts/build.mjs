import { rm } from "node:fs/promises";
import { join } from "node:path";
import { copy, emit, root } from "../../../scripts/distribution/emit.mjs";

// The add-on is a normal package with its own build: the GTK palette is a compiled Vue component
// and core is resolved through the published IDE entrypoint, not embedded.
const pkg = join(root, "packages/native");
await rm(join(pkg, "dist"), { recursive: true, force: true });
await rm(join(pkg, "LICENSE"), { force: true });
await emit(pkg, join(pkg, "dist"), { externalCore: true });
await copy("LICENSE", join(pkg, "LICENSE"));
console.log("@ai-projector/native собран в packages/native/dist");
