import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

// The browser example is built on its own: one ESM file with no host imports. The type-only
// import of the public author contract is erased, so the artifact is a self-contained module.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: fileURLToPath(new URL("./src/browser.ts", import.meta.url)),
      formats: ["es"],
      fileName: () => "browser.js",
    },
  },
});
