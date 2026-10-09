import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, loadConfigFromFile } from "vite-plus";

/** Serve Vue browser fixtures without Projector's production API, PTYs or instance state. */
export async function createBrowserFixture(route, html) {
  const directory = await mkdtemp(join(tmpdir(), "projector-browser-fixture-"));
  const loaded = await loadConfigFromFile({ command: "serve", mode: "development" });
  const fixture = {
    name: "browser-fixture",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] === route) {
          res.setHeader("Content-Type", "text/html");
          void server.transformIndexHtml(req.url, html).then((body) => res.end(body));
        } else if (req.url === "/__tick") setTimeout(() => res.end("ok"), 20);
        else next();
      });
    },
  };
  const server = await createServer({
    ...loaded.config,
    configFile: false,
    plugins: [
      ...loaded.config.plugins.filter((plugin) => plugin.name !== "projector-api"),
      fixture,
    ],
    cacheDir: join(directory, "vite-cache"),
    optimizeDeps: { ...loaded.config.optimizeDeps, entries: [] },
    server: { host: "127.0.0.1", port: 0, strictPort: false },
    logLevel: "error",
  });
  await server.listen();
  return {
    directory,
    url: `http://127.0.0.1:${server.httpServer.address().port}${route}`,
    async close() {
      await server.close();
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}
