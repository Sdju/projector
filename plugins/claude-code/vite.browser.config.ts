import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

// The browser entry is built after the server bundle. `emptyOutDir` stays false so this pass
// does not wipe `dist/server.cjs`. Type-only imports of the public author contract are erased.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: fileURLToPath(new URL("./src/browser.ts", import.meta.url)),
      formats: ["es"],
      fileName: () => "browser.js",
    },
  },
});
