import { fileURLToPath } from "node:url";
import {
  createRunnableDevEnvironment,
  isRunnableDevEnvironment,
  normalizePath,
  type Plugin,
} from "vite-plus";
import { DevRuntime } from "./dev-runtime.ts";
import type { RuntimeModule } from "./runtime-contract.ts";

/** Keep this entry lightweight: the config bundle must never contain the server API graph. */
export function projectorPlugin(): Plugin {
  let runtime: DevRuntime | undefined;
  const entry = fileURLToPath(new URL("./plugin.ts", import.meta.url));
  return {
    name: "projector-api",
    apply(_config, { mode }) {
      // Tests that need API/PTY bind their own isolated servers; the Vitest coordinator does not.
      return mode !== "test";
    },
    async hotUpdate({ file }) {
      if (this.environment.name !== "ssr") return;
      const root = normalizePath(this.environment.config.root) + "/";
      const path = normalizePath(file);
      if (!path.startsWith(root + "packages/server/") && !path.startsWith(root + "packages/core/"))
        return;
      await runtime?.update(path);
      return [];
    },
    async configureServer(server) {
      const environment = server.environments.ssr;
      if (!isRunnableDevEnvironment(environment))
        throw new Error("Projector requires a runnable SSR environment");
      runtime = new DevRuntime(
        environment,
        entry,
        (error) => {
          const message = error instanceof Error ? error.message : String(error);
          server.config.logger.error(`Projector API reload failed: ${message}`, {
            timestamp: true,
          });
          server.environments.client.hot.send({
            type: "error",
            err: { message: `Projector API: ${message}`, stack: "" },
          });
        },
        () => server.environments.client.hot.send({ type: "update", updates: [] }),
      );
      const owner = runtime;
      try {
        await owner.start(server.httpServer);
      } catch (error) {
        // Vite retains the previous server after a failed config reload, but does not close
        // the new server whose configureServer hook rejected. Dispose its watcher and runner.
        owner.close();
        if (runtime === owner) runtime = undefined;
        await server.close();
        throw error;
      }
      server.middlewares.use((req, res, next) => owner.handle(req, res, next));
      server.httpServer?.once("close", () => {
        owner.close();
        if (runtime === owner) runtime = undefined;
      });
    },
    async configurePreviewServer(server) {
      // Preview has no HMR but still needs a live runner for deferred platform imports.
      const environment = createRunnableDevEnvironment("ssr", server.config, {
        hot: false,
        runnerOptions: { hmr: false },
      });
      await environment.init();
      try {
        const api = (await environment.runner.import(entry)) as RuntimeModule;
        const dispose = api.bindRuntime(server.httpServer, "prod");
        const handlers = api.getRuntimeHandlers();
        server.middlewares.use((req, res, next) => {
          void handlers.handleHttp(req, res, next).catch(() => {
            if (!res.headersSent) res.writeHead(500);
            res.end();
          });
        });
        server.httpServer.once("close", () => {
          dispose();
          void environment.close();
        });
      } catch (error) {
        await environment.close();
        throw error;
      }
    },
  };
}
