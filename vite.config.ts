import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite-plus";
import { APP_PORT } from "./server/paths.ts";
import { projectorPlugin } from "./server/plugin.ts";

export default defineConfig({
  plugins: [vue(), projectorPlugin()],
  resolve: {
    alias: {
      "@app": fileURLToPath(new URL("./src/app", import.meta.url)),
      "@pages": fileURLToPath(new URL("./src/pages", import.meta.url)),
      "@modules": fileURLToPath(new URL("./src/modules", import.meta.url)),
      "@common": fileURLToPath(new URL("./src/common", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  server: {
    host: "localhost",
    port: APP_PORT,
    strictPort: true,
  },
  preview: {
    host: "localhost",
    port: APP_PORT,
    strictPort: true,
  },
  run: {
    tasks: {
      server: { command: "./bin/projector --server", cache: false },
      window: { command: "./bin/projector --window", cache: false },
      native: { command: "./bin/projector --native", cache: false },
      browser: { command: "./bin/projector --browser", cache: false },
      toggle: { command: "./bin/projector toggle", cache: false },
      tray: { command: "./bin/projector --tray", cache: false },
      launch: { command: "./bin/projector", cache: false },
      desktop: { command: "./bin/install-desktop", cache: false },
    },
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
});
