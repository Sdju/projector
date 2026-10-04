import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { handleApi } from "./api.ts";
import { bindRuntime } from "./plugin.ts";
import { serveStatic } from "./static.ts";
import { APP_PORT, readNetworkMode } from "../../core/modules/app-paths/index.ts";
import { networkHost } from "../../core/modules/network-mode/index.ts";

/** Prod-сервер без Vite: собранный `dist` и API Projector на чистом Node. */
const root = fileURLToPath(new URL("../../dist", import.meta.url));
if (!existsSync(root + "/index.html")) {
  console.error("dist не найден: выполните vp build");
  process.exit(1);
}

const server = createServer((req, res) => {
  void handleApi(req, res)
    .then((handled) => (handled ? undefined : serveStatic(root, req, res)))
    .catch((error) => {
      console.error(error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
});

bindRuntime(server, "prod");
server.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
const host = networkHost(readNetworkMode());
const port = Number(process.env.PROJECTOR_PORT) || APP_PORT;
server.listen(port, host, () =>
  console.log(`Projector (prod): http://localhost:${port}`),
);

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0));
