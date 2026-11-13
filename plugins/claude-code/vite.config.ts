import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

// The plugin is built on its own: a single CommonJS module that the Projector server loads after
// the user trusts the package. Type-only imports of server code are erased here; the Agent SDK is
// loaded from the server's own dependencies at runtime, like Node built-ins, so it is not bundled
// and its platform binary keeps working.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  ssr: { external: ["@anthropic-ai/claude-agent-sdk"] },
  build: {
    target: "node24",
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
