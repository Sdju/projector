import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import Icons from "unplugin-icons/vite";
import { defineConfig, type Plugin } from "vite-plus";
import { createConfig as createFeodConfig } from "@o-feod/oxlint-structure-plugin/configs";
import feod from "./feod.config.mjs";
import { checkFeod, checkFeodAsync } from "./scripts/check-feod.mjs";
import { APP_PORT, readNetworkMode } from "./packages/core/modules/app-paths/index.ts";
import { networkHost } from "./packages/core/modules/network-mode/index.ts";
import { projectorPlugin } from "./packages/server/app/dev-plugin.ts";

function architecturePlugin(): Plugin {
  const describe = (errors: ReturnType<typeof checkFeod>) =>
    "FEOD architecture violations:\n" +
    errors
      .map((item: { file: string; message: string }) => `${item.file}: ${item.message}`)
      .join("\n");
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
      // Vitest owns these servers and runs the architecture task itself: a repo-wide oxlint scan
      // beside the tests only competes for CPU, logs on timeout and keeps the worker alive.
      if (process.env.VITEST || server.config.mode === "test") return;
      checkFeodAsync().then(
        (errors) => {
          if (errors.length) server.config.logger.error(describe(errors));
        },
        (error) => server.config.logger.warn(`Проверка FEOD не выполнена: ${error.message}`),
      );
    },
  };
}

const packageManifest = (name: string) =>
  JSON.parse(readFileSync(new URL(`./packages/${name}/package.json`, import.meta.url), "utf8")) as {
    dependencies?: Record<string, string>;
  };

/** Third-party packages are external for SSR; workspace packages stay in the Vite graph. */
const ssrExternal = [
  ...new Set(
    ["server", "core"].flatMap((name) => Object.keys(packageManifest(name).dependencies ?? {})),
  ),
].filter((name) => !name.startsWith("@ai-projector/"));

const feodLint = createFeodConfig(feod, { rootDir: fileURLToPath(new URL(".", import.meta.url)) });

export default defineConfig({
  ssr: { external: ssrExternal },
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        hub: fileURLToPath(new URL("./hub.html", import.meta.url)),
      },
    },
  },
  plugins: [architecturePlugin(), vue(), Icons({ compiler: "vue3" }), projectorPlugin()],
  resolve: {
    alias: {
      "@app": fileURLToPath(new URL("./packages/client/app", import.meta.url)),
      "@pages": fileURLToPath(new URL("./packages/client/pages", import.meta.url)),
      "@modules": fileURLToPath(new URL("./packages/client/modules", import.meta.url)),
      "@common": fileURLToPath(new URL("./packages/client/common", import.meta.url)),
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
      desktop: { command: "node packages/cli/app/install-desktop.ts", cache: false },
    },
  },
  test: {
    include: ["tests/**/*.{test,cases}.mjs", "packages/*/tests/**/*.{test,cases}.mjs"],
    setupFiles: ["tests/setup.mjs"],
    pool: "forks",
    // Browser tests also start Vite and Chromium processes; leave room for the desktop.
    maxWorkers: 2,
    // Each browser test owns a Vite server and a Chromium: cap their overlap per worker so a
    // four-core CI runner is not asked to host ten browsers at once.
    maxConcurrency: process.env.CI ? 2 : 5,
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
