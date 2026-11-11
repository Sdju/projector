import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

// The plugin is built on its own: a single CommonJS module that the Projector server loads after
// the user trusts the package. Type-only imports of server code are erased here; Node built-ins stay
// external `require` calls. CommonJS avoids a computed dynamic import in the host.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  build: {
    target: "node24",
    // Node built-ins stay real `require` calls; the server loads this module in-process.
    ssr: true,
    outDir: "dist",
    rollupOptions: {
      output: { entryFileNames: "server.cjs" },
    },
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      formats: ["cjs"],
      fileName: () => "server.cjs",
    },
  },
});
