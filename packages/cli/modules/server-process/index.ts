import { spawn, spawnSync, type SpawnOptions } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { os } from "@projector/core/modules/os/index.ts";
import { serverCommand, type ServerMode } from "@projector/core/modules/server-mode/index.ts";
import { openLog, serverLogPath } from "@projector/core/modules/app-paths/index.ts";
import type { CliOptions } from "../arguments/index.ts";

export interface ServerProcessConfig {
  root: string;
  dataDir: string;
  packaged: boolean;
  launchMode: () => ServerMode;
  options: CliOptions;
}

export interface ServerProcesses {
  findVp(): string;
  ensureBuilt(vp: string, serverMode: ServerMode): Promise<void>;
  startForeground(vp: string): void;
  startDaemon(vp: string): number | undefined;
  buildFrontend(vp: string): Promise<void>;
  assertDevToolchain(vp: string): void;
}

/** Locates `vp`, builds the frontend and starts the server in foreground or as a daemon. */
export function createServerProcesses({
  root,
  dataDir,
  packaged,
  launchMode,
  options,
}: ServerProcessConfig): ServerProcesses {
  function findVp(): string {
    // Start Menu / wscript launches with a minimal PATH: prefer the checkout's
    // vite-plus CLI (spawned via node) over a bare `vp` that only works in a prepared shell.
    const shims = process.platform === "win32" ? ["vp.cmd", "vp"] : ["vp", "vp.cmd"];
    const dirs = [os.toolchainBin(), join(root, "node_modules", ".bin")];
    const candidates = [
      process.env.VP,
      join(root, "node_modules", "vite-plus", "bin", "vp"),
      ...dirs.flatMap((dir) => shims.map((name) => join(dir, name))),
      "vp",
    ].filter((value): value is string => Boolean(value));
    for (const bin of candidates) {
      if (isAbsolute(bin) && existsSync(bin)) return bin;
      if (!isAbsolute(bin) && os.tools.commandExists(bin)) return bin;
    }
    return "vp";
  }

  function childEnv(): NodeJS.ProcessEnv {
    const pathDirs = [os.toolchainBin(), join(root, "node_modules", ".bin")];
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: [...pathDirs, process.env.PATH].filter(Boolean).join(delimiter),
    };
    // Одноразовый режим доступа: не сохраняется на диск и не влияет на следующие запуски.
    if (options.lan) env.PROJECTOR_NETWORK = "lan";
    else if (options.local) env.PROJECTOR_NETWORK = "local";
    return env;
  }

  /** Spawn `vp` whether it is a .cmd shim, a Unix binary, or the vite-plus JS CLI. */
  function spawnVp(vp: string, vpArgs: string[], spawnOptions: SpawnOptions) {
    const win = process.platform === "win32";
    const hide = spawnOptions.windowsHide ?? win;
    if (/[\\/]vite-plus[\\/]bin[\\/]vp$/i.test(vp)) {
      return spawn(process.execPath, [vp, ...vpArgs], {
        ...spawnOptions,
        windowsHide: hide,
      });
    }
    return spawn(vp, vpArgs, {
      ...spawnOptions,
      shell: win && /\.(cmd|bat)$/i.test(vp),
      windowsHide: hide,
    });
  }

  function run(vp: string, commandArgs: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawnVp(vp, commandArgs, {
        cwd: root,
        stdio: "inherit",
        env: childEnv(),
        windowsHide: false,
      });
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`vp ${commandArgs.join(" ")} завершился (${code})`)),
      );
    });
  }

  function buildFrontend(vp: string): Promise<void> {
    console.log("Сборка фронтенда (vp build)…");
    return run(vp, ["build"]);
  }

  async function ensureBuilt(vp: string, serverMode: ServerMode): Promise<void> {
    if (serverMode === "prod" && !existsSync(join(root, "dist", "index.html"))) {
      if (packaged) throw new Error("Повреждена установка: отсутствует dist/index.html");
      await buildFrontend(vp);
    }
  }

  function serverPaths(vp: string) {
    return { vp, node: process.execPath, root, compiled: packaged };
  }

  /** `vp` is a wrapper: it spawns `vite.js` without CREATE_NO_WINDOW. */
  function windowsViteCli(): string | undefined {
    return [
      join(root, "node_modules", "vite", "dist", "vite", "bin", "vite.js"),
      join(
        root,
        "node_modules",
        "@voidzero-dev",
        "vite-plus-core",
        "dist",
        "vite",
        "bin",
        "vite.js",
      ),
    ].find((file) => existsSync(file));
  }

  function daemonCommand(vp: string): { command: string; args: string[] } {
    const planned = serverCommand(launchMode(), serverPaths(vp));
    if (process.platform !== "win32" || planned.args[0] !== "dev") return planned;
    const viteJs = windowsViteCli();
    if (!viteJs) return planned;
    return { command: process.execPath, args: [viteJs, ...planned.args] };
  }

  function daemonEnv(): NodeJS.ProcessEnv {
    return {
      ...childEnv(),
      NODE_PACKAGE_MANAGER: "vite-plus",
      JS_RUNTIME_NAME: process.release.name,
      JS_RUNTIME_VERSION: process.versions.node,
    };
  }

  function startForeground(vp: string): void {
    const { command, args } = serverCommand(launchMode(), serverPaths(vp));
    const child = spawnVp(command, args, {
      cwd: root,
      stdio: "inherit",
      env: childEnv(),
      windowsHide: false,
    });
    child.once("error", (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
    child.on("exit", (code) => {
      process.exit(code ?? 0);
    });
  }

  function startDaemon(vp: string): number | undefined {
    mkdirSync(dataDir, { recursive: true });
    const logPath = serverLogPath();
    const logFd = openLog(logPath);
    const { command, args } = daemonCommand(vp);
    // Hidden console: Start Menu uses wscript, but a detached console-subsystem
    // child still gets a window unless CREATE_NO_WINDOW is set on that process.
    const child = spawnVp(command, args, {
      cwd: root,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...daemonEnv(), PROJECTOR_SERVER_LOG: logPath },
      windowsHide: true,
    });
    // Without a listener, spawn ENOENT becomes an uncaught exception and aborts the CLI
    // after the Start Menu already hid the console — looks like a silent crash.
    child.once("error", (error) => {
      try {
        const message =
          error instanceof Error ? `${error.stack || error.message}\n` : `${String(error)}\n`;
        writeSync(logFd, message);
      } catch {
        /* log best-effort */
      }
    });
    child.unref();
    return child.pid;
  }

  function vitePlusCliPresent(): boolean {
    const files = [
      join(
        root,
        "node_modules",
        "@voidzero-dev",
        "vite-plus-core",
        "dist",
        "vite",
        "bin",
        "vite.js",
      ),
      join(root, "node_modules", "vite", "dist", "vite", "bin", "vite.js"),
    ];
    if (files.some((file) => existsSync(file))) return true;
    const store = join(root, "node_modules", ".pnpm");
    if (!existsSync(store)) return false;
    for (const name of readdirSync(store)) {
      if (!name.startsWith("@voidzero-dev+vite-plus-cor")) continue;
      if (
        existsSync(
          join(
            store,
            name,
            "node_modules",
            "@voidzero-dev",
            "vite-plus-core",
            "dist",
            "vite",
            "bin",
            "vite.js",
          ),
        )
      )
        return true;
    }
    return false;
  }

  function assertDevToolchain(vp: string): void {
    if (launchMode() !== "dev") return;
    if (!existsSync(vp) && vp === "vp")
      throw new Error(`Не найден vp. Выполните pnpm install в ${root}`);
    // vite-plus requires bin/vite.js even when node/cli.js is still present.
    if (vitePlusCliPresent()) return;
    const repair = join(root, "scripts", "ensure-vite-plus-core.mjs");
    if (existsSync(repair)) {
      const result = spawnSync(process.execPath, [repair], {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
        timeout: 120000,
      });
      if (result.stdout) console.error(result.stdout.trim());
      if (result.stderr) console.error(result.stderr.trim());
      if (vitePlusCliPresent()) return;
    }
    throw new Error(
      `Повреждён node_modules (нет vite-plus-core/cli.js). В ${root} выполните: pnpm install`,
    );
  }

  return {
    findVp,
    ensureBuilt,
    startForeground,
    startDaemon,
    buildFrontend,
    assertDevToolchain,
  };
}
