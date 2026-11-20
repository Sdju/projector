import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { handleApi } from "./api.ts";
import { bindRuntime } from "./plugin.ts";
import { serveStatic } from "./static.ts";
import {
  appUrl,
  configuredAppPort,
  readNetworkMode,
} from "@ai-projector/core/modules/app-paths/index.ts";
import { networkHost } from "@ai-projector/core/modules/network-mode/index.ts";
import { authorizeHttp } from "../modules/access/index.ts";
import { handleProxyHost, isProxyHost } from "../modules/browser/index.ts";

/** Prod-сервер без Vite: собранный `dist` и API Projector на чистом Node. */
const root = fileURLToPath(new URL("../../../dist", import.meta.url));
const server = createServer((req, res) => {
  if (isProxyHost(req)) {
    void handleProxyHost(req, res);
    return;
  }
  if (!authorizeHttp(req, res, true)) return;
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
server.listen(configuredAppPort(), host, () => console.log(`Projector (prod): ${appUrl()}`));

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0));
