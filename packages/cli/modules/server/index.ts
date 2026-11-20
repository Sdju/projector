import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { os } from "@ai-projector/core/modules/os/index.ts";
import {
  SERVER_MODES,
  isServerMode,
  type ServerMode,
} from "@ai-projector/core/modules/server-mode/index.ts";
import {
  appUrl,
  instancePath,
  serverLogPath,
  writeServerMode,
} from "@ai-projector/core/modules/app-paths/index.ts";
import type { CliOptions } from "../arguments/index.ts";
import type { AppOpenRequest, HealthInfo, ProjectorApi } from "../api/index.ts";
import type { Output } from "../../common/output.ts";
import { createServerProcesses, type ServerProcesses } from "../server-process/index.ts";

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Older instance files may have a default URL alongside the real port. */
export function localServerUrl(fallback: string): string {
  try {
    const { pid, port } = JSON.parse(readFileSync(instancePath(), "utf8")) as {
      pid: number;
      port: number;
    };
    if (
      Number.isSafeInteger(pid) &&
      pid > 0 &&
      Number.isInteger(port) &&
      port > 0 &&
      port <= 65535 &&
      isPidAlive(pid)
    )
      return appUrl(port);
  } catch {
    // No usable instance yet: startup probes the configured port.
  }
  return fallback;
}

export interface ServerControlConfig {
  root: string;
  dataDir: string;
  api: ProjectorApi;
  packaged: boolean;
  launchMode: () => ServerMode;
  options: CliOptions;
  out: Output;
}

export interface ServerControl {
  serverInfo(): Promise<HealthInfo | null>;
  health(): Promise<boolean>;
  openApp(appOptions?: AppOpenRequest, action?: "open" | "quit"): Promise<unknown>;
  ensureServer(): Promise<HealthInfo>;
  startForegroundServer(): Promise<void>;
  switchMode(targetMode: string | undefined, options: CliOptions): Promise<void>;
  alertFailure(message: unknown): void;
}

/** Starts, restarts and probes the one local Projector server. */
export function createServerControl({
  root,
  dataDir,
  api,
  packaged,
  launchMode,
  options,
  out,
}: ServerControlConfig): ServerControl {
  const lockPath = join(dataDir, "launch.lock");
  const serverProcesses: ServerProcesses = createServerProcesses({
    root,
    dataDir,
    packaged,
    launchMode,
    options,
  });

  const serverInfo = api.health;

  async function health(): Promise<boolean> {
    return Boolean(await serverInfo());
  }

  async function openApp(
    appOptions: AppOpenRequest = {},
    action: "open" | "quit" = "open",
  ): Promise<unknown> {
    const response = await fetch(`${api.baseUrl}/api/app/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(appOptions),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || "Не удалось открыть окно");
    }
    return response.json().catch(() => ({}));
  }

  /**
   * A second launch joins the one already starting the server instead of failing: a cold start
   * rebuilds Vite dependencies for 10–20 s, which is longer than a double click.
   */
  async function acquireLock(): Promise<() => Promise<void>> {
    mkdirSync(dataDir, { recursive: true });
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      try {
        const handle = await open(lockPath, "wx");
        await handle.writeFile(String(process.pid));
        return async () => {
          await handle.close();
          await unlink(lockPath).catch(() => undefined);
        };
      } catch {
        const raw = await readFile(lockPath, "utf8").catch(() => "");
        const pid = Number(raw.trim());
        if (pid && !isPidAlive(pid)) {
          await unlink(lockPath).catch(() => undefined);
          continue;
        }
        if (await health()) return async () => undefined;
        await sleep(200);
      }
    }
    throw new Error(`Запуск уже выполняется больше двух минут. См. ${serverLogPath()}`);
  }

  async function waitUntilReady(timeoutMs = 90000, daemonPid?: number): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await health()) return;
      if (daemonPid && !isPidAlive(daemonPid)) {
        throw new Error(`Сервер сразу завершился. См. лог: ${serverLogPath()}`);
      }
      await sleep(200);
    }
    throw new Error(
      `Сервер не поднялся за ${Math.round(timeoutMs / 1000)} с. См. ${serverLogPath()}`,
    );
  }

  /** Start Menu uses a hidden console — surface failures with a MessageBox on Windows. */
  function alertFailure(message: unknown): void {
    const text = String(message);
    console.error(text);
    try {
      mkdirSync(dataDir, { recursive: true });
      appendFileSync(join(dataDir, "launch-err.log"), `${new Date().toISOString()} ${text}\n`);
    } catch {
      /* log best-effort */
    }
    os.alertHiddenFailure(text);
  }

  async function ensureServer(): Promise<HealthInfo> {
    const existing = await serverInfo();
    if (existing) return existing;
    const release = await acquireLock();
    try {
      const startedByAnother = await serverInfo();
      if (startedByAnother) return startedByAnother;
      const vp = serverProcesses.findVp();
      serverProcesses.assertDevToolchain(vp);
      await serverProcesses.ensureBuilt(vp, launchMode());
      const daemonPid = serverProcesses.startDaemon(vp);
      await waitUntilReady(90000, daemonPid);
      const info = await serverInfo();
      if (!info) throw new Error(`Сервер не ответил после запуска. См. ${serverLogPath()}`);
      return info;
    } finally {
      await release();
    }
  }

  async function startForegroundServer(): Promise<void> {
    const release = await acquireLock();
    let released = false;
    const done = async () => {
      if (released) return;
      released = true;
      await release();
    };
    try {
      if (await health()) {
        out(`уже запущен: ${api.baseUrl}`);
        return;
      }
      const vp = serverProcesses.findVp();
      serverProcesses.assertDevToolchain(vp);
      await serverProcesses.ensureBuilt(vp, launchMode());
      await done();
      serverProcesses.startForeground(vp);
    } finally {
      await done();
    }
  }

  /** Меняет режим на диске и, если сервер работает в другом режиме, перезапускает его. */
  async function switchMode(
    targetMode: string | undefined,
    modeOptions: CliOptions,
  ): Promise<void> {
    const release = await acquireLock();
    try {
      const info = await serverInfo();
      if (!targetMode) {
        if (modeOptions.json)
          out(
            JSON.stringify(
              {
                mode: launchMode(),
                server: info ? { pid: info.pid, mode: info.mode ?? "dev" } : null,
              },
              null,
              2,
            ),
          );
        else {
          out(`режим: ${launchMode()}`);
          out(info ? `сервер: ${info.mode ?? "dev"} (pid ${info.pid})` : "сервер не запущен");
        }
        return;
      }
      if (!isServerMode(targetMode)) throw new Error(`Режим: ${SERVER_MODES.join(" | ")}`);
      if (packaged && targetMode === "dev")
        throw new Error("Режим dev доступен только в checkout исходников Projector");
      const vp = serverProcesses.findVp();
      // Сборку делаем до остановки сервера: при ошибке старый процесс и терминалы остаются.
      if (targetMode === "prod" && !packaged) await serverProcesses.buildFrontend(vp);
      writeServerMode(targetMode);
      if (!info) {
        if (modeOptions.json)
          out(JSON.stringify({ mode: targetMode, server: null, changed: true }, null, 2));
        else out(`режим ${targetMode} сохранён; сервер не запущен`);
        return;
      }
      if ((info.mode ?? "dev") === targetMode) {
        if (modeOptions.json)
          out(
            JSON.stringify(
              {
                mode: targetMode,
                server: { pid: info.pid, mode: targetMode },
                changed: false,
              },
              null,
              2,
            ),
          );
        else out(`уже работает в режиме ${targetMode}`);
        return;
      }
      if (!modeOptions.json)
        out(`перезапуск в режиме ${targetMode}: терминалы и их процессы будут завершены`);
      await openApp({}, "quit");
      await os.processes.waitForExit(info.pid, 15000);
      const daemonPid = serverProcesses.startDaemon(vp);
      await waitUntilReady(90000, daemonPid);
      await openApp({ tray: true });
      const next = await serverInfo();
      if (modeOptions.json)
        out(
          JSON.stringify(
            {
              mode: targetMode,
              server: next ? { pid: next.pid, mode: next.mode ?? targetMode } : null,
              changed: true,
            },
            null,
            2,
          ),
        );
      else out(`сервер работает в режиме ${targetMode}`);
    } finally {
      await release();
    }
  }

  return {
    serverInfo,
    health,
    openApp,
    ensureServer,
    startForegroundServer,
    switchMode,
    alertFailure,
  };
}
