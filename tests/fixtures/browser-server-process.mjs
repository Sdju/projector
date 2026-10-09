import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createServer, loadConfigFromFile } from "vite-plus";

/**
 * Vite server of a browser fixture, run apart from the test worker: the Vite+ dev server crashes
 * natively now and then, and that must cost a retried test, not the whole Vitest worker.
 * The spec comes in PROJECTOR_FIXTURE; commands (`restart`, `close`) come in on stdin.
 */
const { pages, responses = [] } = JSON.parse(process.env.PROJECTOR_FIXTURE);
const directory =
  process.env.PROJECTOR_FIXTURE_DIR ?? (await mkdtemp(join(tmpdir(), "projector-fixture-")));
const loaded = await loadConfigFromFile({ command: "serve", mode: "development" });
const matches = (rule, url) =>
  (rule.equals === undefined || rule.equals === url) &&
  (rule.startsWith === undefined || url.startsWith(rule.startsWith)) &&
  (rule.includes === undefined || url.includes(rule.includes));
const fixture = {
  name: "browser-fixture",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = req.url ?? "";
      const page = pages[url.split("?")[0]];
      if (page !== undefined) {
        res.setHeader("Content-Type", "text/html");
        void server.transformIndexHtml(url, page).then((body) => res.end(body));
        return;
      }
      if (url === "/__tick") {
        setTimeout(() => res.end("ok"), 20);
        return;
      }
      const rule = responses.find((item) => matches(item, url));
      if (!rule) return next();
      res.statusCode = rule.status ?? 200;
      if (rule.type) res.setHeader("Content-Type", rule.type);
      res.end(rule.body ?? "");
    });
  },
};
const server = await createServer({
  ...loaded.config,
  configFile: false,
  // Never attach Projector's API/PTY server or write its instance file in this fixture.
  plugins: [...loaded.config.plugins.filter((plugin) => plugin.name !== "projector-api"), fixture],
  cacheDir: join(directory, "vite-cache"),
  optimizeDeps: { ...loaded.config.optimizeDeps, entries: [] },
  server: { host: "127.0.0.1", port: 0, strictPort: false },
  logLevel: "error",
});
await server.listen();
const port = () => server.httpServer.address().port;
console.log(`ready ${port()}`);
for await (const line of createInterface({ input: process.stdin })) {
  if (line === "restart") {
    await server.restart();
    console.log(`restarted ${port()}`);
  } else if (line === "close") break;
}
await server.close();
await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
process.exit(0);
