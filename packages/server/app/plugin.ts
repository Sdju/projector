import { bindHub } from "../modules/hub/index.ts";
import { findProject, loadProjects } from "../modules/projects/index.ts";
import { bindWorkspaceEvents } from "../modules/workspace/index.ts";
import type { RuntimeHandlers } from "./runtime-contract.ts";
import type { HttpServer } from "vite-plus";
import { handleApi } from "./api.ts";
import { clearInstance, writeInstance } from "../modules/instance/index.ts";
import {
  APP_PORT,
  appUrl,
  startServerLogRotation,
} from "@projector/core/modules/app-paths/index.ts";
import { os } from "@projector/core/modules/os/index.ts";
import { CLAUDE_SESSION_ENV } from "../modules/agents/claude-code/index.ts";
import { openLauncher, startTray } from "../modules/window/index.ts";
import type { ServerMode } from "@projector/core/modules/server-mode/index.ts";
import { attachTerminalServer, listTerminalSessions } from "../modules/terminal/index.ts";
import { pruneRuns, recoverJobs, bindAgentEventStreams } from "../modules/agent/index.ts";
import { registerBuiltinAgents } from "./agents.ts";
import { registerBuiltinWidgetDefinitions } from "./widgets.ts";
import { registerBuiltinAgentFeatures } from "./features.ts";
import { ensureIdeMcpToken, bindIdeCommandEvents } from "../modules/ide/index.ts";
import { reconcileOnStartup } from "../modules/environments/index.ts";

import {
  attachSharedTerminalServer,
  attachTerminalControlServer,
  terminalControl,
} from "../modules/terminal-control/index.ts";
import { authorizeHttp, accessAllowed } from "../modules/access/index.ts";
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
export function bindRuntime(
  httpServer: HttpServer | null,
  mode: ServerMode,
  handlers: () => RuntimeHandlers = getRuntimeHandlers,
): () => void {
  // The daemon owns its log file: keep it bounded while dev warnings write megabytes.
  startServerLogRotation();
  // Регистрация при вызове, а не при импорте: импорт конфига Vite не должен трогать агентов.
  registerBuiltinAgents();
  registerBuiltinWidgetDefinitions();
  registerBuiltinAgentFeatures();
  void ensureIdeMcpToken().catch((error: unknown) =>
    console.error("Ключ IDE MCP:", error instanceof Error ? error.message : error),
  );
  // Сервер, запущенный из сессии Claude Code, иначе передаёт её метки каждому терминалу и агенту.
  os.clearSessionEnv(CLAUDE_SESSION_ENV);
  runtime.projectorRuntimeMode = mode;
  const subscriptions = [bindAgentEventStreams(), bindIdeCommandEvents(), bindWorkspaceEvents()];
  const deactivate = () => subscriptions.forEach((off) => off());
  if (!httpServer) return deactivate;
  const allowed: typeof accessAllowed = (...args) => handlers().accessAllowed(...args);
  const operations = {
    allowed,
    control: (...args: Parameters<typeof terminalControl>) => handlers().terminalControl(...args),
    sessions: (...args: Parameters<typeof listTerminalSessions>) =>
      handlers().terminalSessions(...args),
    project: (...args: Parameters<typeof findProject>) => handlers().findProject(...args),
  };
  const transports = [
    attachTerminalServer(httpServer, {
      allowed,
      projects: (...args) => handlers().loadProjects(...args),
    }),
    attachTerminalControlServer(httpServer, operations),
    attachSharedTerminalServer(httpServer, operations),
  ];
  const stopHub = bindHub({
    handle(req, res) {
      void handlers()
        .handleHttp(req, res, () => res.writeHead(404).end())
        .catch(() => {
          if (!res.headersSent) res.writeHead(500);
          res.end();
        });
    },
    attach(server) {
      const disposers = [
        attachTerminalServer(server, {
          allowed,
          projects: (...args) => handlers().loadProjects(...args),
        }),
        attachTerminalControlServer(server, operations),
        attachSharedTerminalServer(server, operations),
      ];
      return () => disposers.forEach((dispose) => dispose?.());
    },
  });
  const listening = () => {
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
    // Child agents and their MCP servers reach this exact address, even on a non-default port.
    process.env.PROJECTOR_URL = url;
    if (process.env.PROJECTOR_WINDOW === "1") {
      void openLauncher(url).catch(console.error);
    } else if (os.supported) {
      // `vp dev` не открывает палитру, но хоткей и иконка должны быть сразу.
      void startTray(url).catch((error: unknown) =>
        console.warn("Трей недоступен:", error instanceof Error ? error.message : error),
      );
    }
  };
  if (httpServer.listening) bindHooks();
  else httpServer.once("listening", listening);
  return () => {
    httpServer.off("listening", listening);
    stopHub();
    for (const dispose of transports) dispose?.();
    deactivate();
  };
}

/** A complete request/operation generation; no resource is recreated while constructing it. */
export function getRuntimeHandlers(): RuntimeHandlers {
  return {
    async handleHttp(req, res, next) {
      if (isProxyHost(req)) {
        await handleProxyHost(req, res);
        return;
      }
      if (!authorizeHttp(req, res, true)) return;
      if (!(await handleApi(req, res))) next();
    },
    terminalControl,
    terminalSessions: listTerminalSessions,
    accessAllowed,
    findProject,
    loadProjects,
  };
}
