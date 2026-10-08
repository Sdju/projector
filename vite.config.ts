import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import Icons from "unplugin-icons/vite";
import { defineConfig, type Plugin } from "vite-plus";
import { createConfig as createFeodConfig } from "@o-feod/oxlint-structure-plugin/configs";
import feod from "./feod.config.mjs";
import { checkFeod, checkFeodAsync } from "./scripts/check-feod.mjs";
import { APP_PORT, readNetworkMode } from "./core/modules/app-paths/index.ts";
import { networkHost } from "./core/modules/network-mode/index.ts";
import { projectorPlugin } from "./server/app/plugin.ts";

function architecturePlugin(): Plugin {
  const describe = (errors: ReturnType<typeof checkFeod>) =>
    "FEOD architecture violations:\n" +
    errors.map((item) => `${item.file}: ${item.message}`).join("\n");
  let serving = false;
  return {
    name: "projector-feod",
    configResolved(config) {
      serving = config.command === "serve";
    },
    // A build is the gate: the full check, blocking. The dev server only reports: the check runs
    // beside it, so a violation, a slow check or an oxlint crash never stops or freezes the server.
    buildStart() {
      if (serving) return;
      const errors = checkFeod();
      if (errors.length) throw new Error(describe(errors));
    },
    configureServer(server) {
      checkFeodAsync().then(
        (errors) => {
          if (errors.length) server.config.logger.error(describe(errors));
        },
        (error) => server.config.logger.warn(`Проверка FEOD не выполнена: ${error.message}`),
      );
    },
  };
}

const feodLint = createFeodConfig(feod, { rootDir: fileURLToPath(new URL(".", import.meta.url)) });

export default defineConfig({
  plugins: [architecturePlugin(), vue(), Icons({ compiler: "vue3" }), projectorPlugin()],
  resolve: {
    alias: {
      "@app": fileURLToPath(new URL("./src/app", import.meta.url)),
      "@pages": fileURLToPath(new URL("./src/pages", import.meta.url)),
      "@modules": fileURLToPath(new URL("./src/modules", import.meta.url)),
      "@common": fileURLToPath(new URL("./src/common", import.meta.url)),
      "@core": fileURLToPath(new URL("./core/modules", import.meta.url)),
    },
  },
  server: {
    host: networkHost(readNetworkMode()),
    port: APP_PORT,
    strictPort: true,
  },
  preview: {
    host: networkHost(readNetworkMode()),
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
  test: {
    include: ["tests/**/*.test.mjs"],
    setupFiles: ["tests/setup.mjs"],
    pool: "forks",
    // GTK modules load through the vio `gi:` loader hook instead of Vite.
    execArgv: ["--import", "vio/register"],
    server: { deps: { external: [/^gi:/] } },
    restoreMocks: true,
    testTimeout: 60_000,
    // Cleanup waits for killed process trees to release their folders; Windows is slower at it.
    hookTimeout: 40_000,
  },
  fmt: {},
  staged: {
    "*": "vp fmt --no-error-on-unmatched-pattern",
  },
  lint: {
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      ...(feodLint.jsPlugins ?? []),
    ],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      ...(feodLint.rules as Record<string, "error" | "warn" | "off" | [string, object]>),
    },
    options: { typeAware: true, typeCheck: true },
  },
});
