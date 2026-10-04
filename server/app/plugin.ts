import type { IncomingMessage, ServerResponse } from "node:http";
import type { HttpServer, PreviewServer, ViteDevServer } from "vite";
import type { Plugin } from "vite";
import { handleApi } from "./api.ts";
import { clearInstance, writeInstance } from "../modules/instance/index.ts";
import { APP_PORT, appUrl } from "../../core/modules/app-paths/index.ts";
import { openLauncher } from "../modules/window/index.ts";
import type { ServerMode } from "../../core/modules/server-mode/index.ts";
import { attachTerminalServer } from "../modules/terminal/index.ts";
import { reconcileOnStartup } from "../modules/environments/index.ts";

import { attachTerminalControlServer } from "../modules/terminal-control/index.ts";
import { authorizeHttp } from "../modules/access/index.ts";

let hooksBound = false;

/** Режим текущего процесса: его сообщает /api/health. */
const runtime = globalThis as typeof globalThis & { projectorRuntimeMode?: ServerMode };

function listenAddress(address: string | { port: number } | null): string {
  if (address && typeof address === "object") {
    return `http://localhost:${address.port}`;
  }
  return appUrl();
}

function bindHooks(): void {
  if (hooksBound) return;
  hooksBound = true;
  process.on("exit", () => {
    void clearInstance();
  });
}

/** Общая часть dev, preview и standalone: режим, сокеты терминалов, запись instance, окно. */
export function bindRuntime(httpServer: HttpServer | null, mode: ServerMode): void {
  runtime.projectorRuntimeMode = mode;
  if (!httpServer) return;
  attachTerminalServer(httpServer);
  attachTerminalControlServer(httpServer);
  httpServer.once("listening", () => {
    const address = httpServer.address();
    const port = address && typeof address === "object" ? address.port : APP_PORT;
    void writeInstance(port);
    bindHooks();
    void reconcileOnStartup().catch((error) =>
      console.error("Очистка контейнеров:", error.message),
    );
    if (process.env.PROJECTOR_WINDOW === "1") {
      void openLauncher(listenAddress(address)).catch(console.error);
    }
  });
}

function attach(server: ViteDevServer | PreviewServer, mode: ServerMode): void {
  bindRuntime(server.httpServer, mode);
  server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!authorizeHttp(req, res, true)) return;
    void handleApi(req, res)
      .then((handled) => {
        if (!handled) next();
      })
      .catch(() => {
        if (!res.headersSent) res.writeHead(400);
        res.end();
      });
  });
}

export function projectorPlugin(): Plugin {
  return {
    name: "projector-api",
    configureServer(server) {
      attach(server, "dev");
    },
    configurePreviewServer(server) {
      attach(server, "prod");
    },
  };
}
