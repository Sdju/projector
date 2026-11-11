import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

// The plugin is built on its own: a single self-contained CommonJS module that the Projector
// server loads after the user trusts the package. Type-only imports of server code are erased here.
// CommonJS avoids a computed dynamic import in the host; the entry path is arbitrary at runtime.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  build: {
    target: "node24",
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      formats: ["cjs"],
      fileName: () => "server.cjs",
    },
  },
});
