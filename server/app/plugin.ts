import type { IncomingMessage, ServerResponse } from "node:http";
import type { HttpServer, PreviewServer, ViteDevServer } from "vite";
import type { Plugin } from "vite";
import { handleApi } from "./api.ts";
import { clearInstance, writeInstance } from "../modules/instance/index.ts";
import { APP_PORT, appUrl } from "../../core/modules/app-paths/index.ts";
import { clearAgentSession, os } from "../../core/modules/os/index.ts";
import { openLauncher, startTray } from "../modules/window/index.ts";
import type { ServerMode } from "../../core/modules/server-mode/index.ts";
import { attachTerminalServer } from "../modules/terminal/index.ts";
import { pruneRuns, recoverJobs } from "../modules/agent/index.ts";
import { registerBuiltinAgents } from "./agents.ts";
import { registerBuiltinWidgetDefinitions } from "./widgets.ts";
import { registerBuiltinAgentFeatures } from "./features.ts";
import { reconcileOnStartup } from "../modules/environments/index.ts";

import {
  attachSharedTerminalServer,
  attachTerminalControlServer,
} from "../modules/terminal-control/index.ts";
import { authorizeHttp } from "../modules/access/index.ts";
import { handleProxyHost, isProxyHost } from "../modules/browser/index.ts";

/** Process hooks must survive Vite's config reload without retaining old module closures. */
const runtime = globalThis as typeof globalThis & {
  projectorRuntimeMode?: ServerMode;
  projectorExitHook?: () => void;
};

function listenAddress(address: string | { port: number } | null): string {
  if (address && typeof address === "object") {
    return `http://localhost:${address.port}`;
  }
  return appUrl();
}

function bindHooks(): void {
  if (runtime.projectorExitHook) process.off("exit", runtime.projectorExitHook);
  runtime.projectorExitHook = clearInstance;
  process.on("exit", runtime.projectorExitHook);
}

/** Общая часть dev, preview и standalone: режим, сокеты терминалов, запись instance, окно. */
export function bindRuntime(httpServer: HttpServer | null, mode: ServerMode): void {
  // Регистрация при вызове, а не при импорте: импорт конфига Vite не должен трогать агентов.
  registerBuiltinAgents();
  registerBuiltinWidgetDefinitions();
  registerBuiltinAgentFeatures();
  // Сервер, запущенный из сессии Claude Code, иначе передаёт её метки каждому терминалу и агенту.
  clearAgentSession();
  runtime.projectorRuntimeMode = mode;
  if (!httpServer) return;
  attachTerminalServer(httpServer);
  attachTerminalControlServer(httpServer);
  attachSharedTerminalServer(httpServer);
  httpServer.once("listening", () => {
    const address = httpServer.address();
    const port = address && typeof address === "object" ? address.port : APP_PORT;
    void writeInstance(port);
    bindHooks();
    // Jobs first: they rejoin the runs that the cleanup keeps for them.
    void recoverJobs()
      .catch((error) => console.error("Фоновые агенты:", error.message))
      .then(() => pruneRuns())
      .catch(() => {});
    void reconcileOnStartup().catch((error) =>
      console.error("Очистка контейнеров:", error.message),
    );
    const url = listenAddress(address);
    if (process.env.PROJECTOR_WINDOW === "1") {
      void openLauncher(url).catch(console.error);
    } else if (os.capabilities.nativeDesktop) {
      // `vp dev` не открывает палитру, но хоткей и иконка должны быть сразу.
      void startTray(url).catch((error: unknown) =>
        console.warn("Трей недоступен:", error instanceof Error ? error.message : error),
      );
    }
  });
}

function attach(server: ViteDevServer | PreviewServer, mode: ServerMode): void {
  bindRuntime(server.httpServer, mode);
  server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
    // Origin прокси псевдобраузера имеет собственную проверку и не проходит общую по Host.
    if (isProxyHost(req)) {
      void handleProxyHost(req, res);
      return;
    }
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
