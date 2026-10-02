import type { IncomingMessage, ServerResponse } from "node:http";
import type { PreviewServer, ViteDevServer } from "vite";
import type { Plugin } from "vite";
import { handleApi } from "./api.ts";
import { clearInstance, writeInstance } from "../modules/instance/index.ts";
import { APP_PORT, appUrl } from "../../core/modules/app-paths/index.ts";
import { openLauncher } from "../modules/window/index.ts";
import { attachTerminalServer } from "../modules/terminal/index.ts";

let hooksBound = false;

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

function attach(server: ViteDevServer | PreviewServer): void {
  if (server.httpServer) attachTerminalServer(server.httpServer);
  server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
    void handleApi(req, res).then((handled) => {
      if (!handled) next();
    });
  });

  server.httpServer?.once("listening", () => {
    const address = server.httpServer?.address() ?? null;
    const port = address && typeof address === "object" ? address.port : APP_PORT;
    void writeInstance(port);
    bindHooks();
    if (process.env.PROJECTOR_WINDOW === "1") {
      void openLauncher(listenAddress(address)).catch(console.error);
    }
  });
}

export function projectorPlugin(): Plugin {
  return {
    name: "projector-api",
    configureServer(server) {
      attach(server);
    },
    configurePreviewServer(server) {
      attach(server);
    },
  };
}
