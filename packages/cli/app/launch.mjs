import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, writeSync } from "node:fs";
import { open, readFile, unlink } from "node:fs/promises";
import { os } from "@projector/core/modules/os/index.ts";
import {
  SERVER_MODES,
  isServerMode,
  serverCommand,
} from "@projector/core/modules/server-mode/index.ts";
import {
  openLog,
  readServerMode,
  serverLogPath,
  writeServerMode,
} from "@projector/core/modules/app-paths/index.ts";
import { delimiter, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const packaged = existsSync(join(ROOT, "packages/server/app/standalone.js"));
const launchMode = () => (packaged ? "prod" : readServerMode());
const APP_URL = "http://localhost:4177";
const DATA_DIR = join(os.dataHome(), "projector");
const LOCK_PATH = join(DATA_DIR, "launch.lock");
const serverOnly = process.argv.includes("--server");
const args = process.argv.slice(2);
const modeFlag = args.find((arg) => ["--native", "--window", "--browser"].includes(arg));
const mode = modeFlag?.slice(2);
const toggle = args.includes("toggle") || args.includes("--toggle");
const tray = args.includes("--tray");
const quit = args.includes("quit") || args.includes("--quit");
const lan = args.includes("--lan");
const local = args.includes("--local");
const modeCommand = args[0] === "mode";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function findVp() {
  // Start Menu / wscript launches with a minimal PATH: prefer the checkout's
  // vite-plus CLI (spawned via node) over a bare `vp` that only works in a prepared shell.
  const shims = process.platform === "win32" ? ["vp.cmd", "vp"] : ["vp", "vp.cmd"];
  const dirs = [os.toolchainBin(), join(ROOT, "node_modules", ".bin")];
  const candidates = [
    process.env.VP,
    join(ROOT, "node_modules", "vite-plus", "bin", "vp"),
    ...dirs.flatMap((dir) => shims.map((name) => join(dir, name))),
    "vp",
  ].filter(Boolean);
  for (const bin of candidates) {
    if (isAbsolute(bin) && existsSync(bin)) return bin;
    if (!isAbsolute(bin) && os.tools.commandExists(bin)) return bin;
  }
  return "vp";
}

async function serverInfo() {
  try {
    const response = await fetch(`${APP_URL}/api/health`, { signal: AbortSignal.timeout(500) });
    const data = await response.json();
    return response.ok && data.ok && data.app === "projector" ? data : null;
  } catch {
    return null;
  }
}

async function health() {
  return Boolean(await serverInfo());
}

async function openApp(options = { mode, toggle, tray }, action = quit ? "quit" : "open") {
  const response = await fetch(`${APP_URL}/api/app/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Не удалось открыть окно");
  }
}

async function acquireLock() {
  mkdirSync(DATA_DIR, { recursive: true });
  for (let i = 0; i < 80; i += 1) {
    try {
      const handle = await open(LOCK_PATH, "wx");
      await handle.writeFile(String(process.pid));
      return async () => {
        await handle.close();
        await unlink(LOCK_PATH).catch(() => undefined);
      };
    } catch {
      const raw = await readFile(LOCK_PATH, "utf8").catch(() => "");
      const pid = Number(raw.trim());
      if (pid && !isPidAlive(pid)) {
        await unlink(LOCK_PATH).catch(() => undefined);
        continue;
      }
      if (await health()) return async () => undefined;
      await sleep(100);
    }
  }
  throw new Error("Запуск уже выполняется");
}

async function waitUntilReady(timeoutMs = 30000, daemonPid) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await health()) return;
    if (daemonPid && !isPidAlive(daemonPid)) {
      const logPath = serverLogPath();
      throw new Error(`Сервер сразу завершился. См. лог: ${logPath}`);
    }
    await sleep(200);
  }
  throw new Error(
    `Сервер не поднялся за ${Math.round(timeoutMs / 1000)} с. См. ${serverLogPath()}`,
  );
}

/** Start Menu uses a hidden console — surface failures with a MessageBox on Windows. */
function alertFailure(message) {
  const text = String(message);
  console.error(text);
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    appendFileSync(join(DATA_DIR, "launch-err.log"), `${new Date().toISOString()} ${text}\n`);
  } catch {
    /* log best-effort */
  }
  os.alertHiddenFailure(text);
}

function childEnv() {
  const pathDirs = [os.toolchainBin(), join(ROOT, "node_modules", ".bin")];
  const env = {
    ...process.env,
    PATH: [...pathDirs, process.env.PATH].filter(Boolean).join(delimiter),
  };
  // Одноразовый режим доступа: не сохраняется на диск и не влияет на следующие запуски.
  if (lan) env.PROJECTOR_NETWORK = "lan";
  else if (local) env.PROJECTOR_NETWORK = "local";
  return env;
}

/** Spawn `vp` whether it is a .cmd shim, a Unix binary, or the vite-plus JS CLI. */
function spawnVp(vp, vpArgs, options) {
  const win = process.platform === "win32";
  const hide = options.windowsHide ?? win;
  if (/[\\/]vite-plus[\\/]bin[\\/]vp$/i.test(vp)) {
    return spawn(process.execPath, [vp, ...vpArgs], {
      ...options,
      windowsHide: hide,
    });
  }
  return spawn(vp, vpArgs, {
    ...options,
    shell: win && /\.(cmd|bat)$/i.test(vp),
    windowsHide: hide,
  });
}

function run(vp, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawnVp(vp, commandArgs, {
      cwd: ROOT,
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

function buildFrontend(vp) {
  console.log("Сборка фронтенда (vp build)…");
  return run(vp, ["build"]);
}

async function ensureBuilt(vp, serverMode) {
  if (serverMode === "prod" && !existsSync(join(ROOT, "dist", "index.html"))) {
    if (packaged) throw new Error("Повреждена установка: отсутствует dist/index.html");
    await buildFrontend(vp);
  }
}

function serverPaths(vp) {
  return { vp, node: process.execPath, root: ROOT, compiled: packaged };
}

/** `vp` is a wrapper: it spawns `vite.js` without CREATE_NO_WINDOW. A detached wrapper on Windows therefore leaves an empty `node.exe` console. */
function windowsViteCli() {
  return [
    join(ROOT, "node_modules", "vite", "dist", "vite", "bin", "vite.js"),
    join(ROOT, "node_modules", "@voidzero-dev", "vite-plus-core", "dist", "vite", "bin", "vite.js"),
  ].find((file) => existsSync(file));
}

function daemonCommand(vp) {
  const planned = serverCommand(launchMode(), serverPaths(vp));
  if (process.platform !== "win32" || planned.args[0] !== "dev") return planned;
  const viteJs = windowsViteCli();
  if (!viteJs) return planned;
  return { command: process.execPath, args: [viteJs, ...planned.args] };
}

function daemonEnv() {
  return {
    ...childEnv(),
    NODE_PACKAGE_MANAGER: "vite-plus",
    JS_RUNTIME_NAME: process.release.name,
    JS_RUNTIME_VERSION: process.versions.node,
  };
}

function startForeground(vp) {
  const { command, args } = serverCommand(launchMode(), serverPaths(vp));
  const child = spawnVp(command, args, {
    cwd: ROOT,
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

function startDaemon(vp) {
  mkdirSync(DATA_DIR, { recursive: true });
  const logPath = serverLogPath();
  const logFd = openLog(logPath);
  const { command, args } = daemonCommand(vp);
  // Hidden console: Start Menu uses wscript, but a detached console-subsystem
  // child still gets a window unless CREATE_NO_WINDOW is set on that process.
  const child = spawnVp(command, args, {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...daemonEnv(), PROJECTOR_SERVER_LOG: logPath },
    windowsHide: true,
  });
  // Without a listener, spawn ENOENT becomes an uncaught exception and aborts launch.mjs
  // after the Start Menu already hid the console — looks like a silent crash.
  child.once("error", (error) => {
    try {
      const message = error instanceof Error ? `${error.stack || error.message}\n` : `${error}\n`;
      writeSync(logFd, message);
    } catch {
      /* log best-effort */
    }
  });
  child.unref();
  return child.pid;
}

/** Меняет режим на диске и, если сервер работает в другом режиме, перезапускает его. */
async function switchMode(target) {
  const info = await serverInfo();
  if (!target) {
    console.log(`режим: ${launchMode()}`);
    console.log(info ? `сервер: ${info.mode ?? "dev"} (pid ${info.pid})` : "сервер не запущен");
    return;
  }
  if (!isServerMode(target)) throw new Error(`Режим: ${SERVER_MODES.join(" | ")}`);
  if (packaged && target === "dev")
    throw new Error("Режим dev доступен только в checkout исходников Projector");
  const vp = findVp();
  // Сборку делаем до остановки сервера: при ошибке старый процесс и терминалы остаются.
  if (target === "prod" && !packaged) await buildFrontend(vp);
  writeServerMode(target);
  if (!info) {
    console.log(`режим ${target} сохранён; сервер не запущен`);
    return;
  }
  if ((info.mode ?? "dev") === target) {
    console.log(`уже работает в режиме ${target}`);
    return;
  }
  console.log(`перезапуск в режиме ${target}: терминалы и их процессы будут завершены`);
  await openApp({}, "quit");
  await os.processes.waitForExit(info.pid, 15000);
  const daemonPid = startDaemon(vp);
  await waitUntilReady(30000, daemonPid);
  await openApp({ tray: true });
  console.log(`сервер работает в режиме ${target}`);
}

function vitePlusCliPresent() {
  const files = [
    join(ROOT, "node_modules", "@voidzero-dev", "vite-plus-core", "dist", "vite", "bin", "vite.js"),
    join(ROOT, "node_modules", "vite", "dist", "vite", "bin", "vite.js"),
  ];
  if (files.some((file) => existsSync(file))) return true;
  const store = join(ROOT, "node_modules", ".pnpm");
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

function assertDevToolchain(vp) {
  if (launchMode() !== "dev") return;
  if (!existsSync(vp) && vp === "vp")
    throw new Error(`Не найден vp. Выполните pnpm install в ${ROOT}`);
  // vite-plus requires bin/vite.js even when node/cli.js is still present.
  if (vitePlusCliPresent()) return;
  const repair = join(ROOT, "scripts", "ensure-vite-plus-core.mjs");
  if (existsSync(repair)) {
    const result = spawnSync(process.execPath, [repair], {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
      timeout: 120000,
    });
    if (result.stdout) console.error(result.stdout.trim());
    if (result.stderr) console.error(result.stderr.trim());
    if (vitePlusCliPresent()) return;
  }
  throw new Error(
    `Повреждён node_modules (нет vite-plus-core/cli.js). В ${ROOT} выполните: pnpm install`,
  );
}

async function main() {
  const release = await acquireLock();
  try {
    if (modeCommand) {
      await switchMode(args[1]);
      return;
    }
    if (await health()) {
      if (serverOnly) {
        console.log(`уже запущен: ${APP_URL}`);
        return;
      }
      await openApp();
      return;
    }

    const vp = findVp();
    if (quit) return;
    assertDevToolchain(vp);
    await ensureBuilt(vp, launchMode());
    if (serverOnly) {
      await release();
      startForeground(vp);
      return;
    }

    const daemonPid = startDaemon(vp);
    await waitUntilReady(30000, daemonPid);
    await openApp();
  } finally {
    await release();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  alertFailure(message);
  process.exit(1);
});
