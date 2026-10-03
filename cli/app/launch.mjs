import { execFileSync, spawn } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, openSync } from "node:fs";
import { open, readFile, unlink } from "node:fs/promises";
import { os } from "../../core/modules/os/index.ts";
import { SERVER_MODES, isServerMode, serverCommand } from "../../core/modules/server-mode/index.ts";
import { readServerMode, writeServerMode } from "../../core/modules/app-paths/index.ts";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
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

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findVp() {
  const candidates = [process.env.VP, join(os.toolchainBin(), "vp"), "vp"].filter(Boolean);
  for (const bin of candidates) {
    if (bin.includes("/") && isExecutable(bin)) return bin;
    try {
      execFileSync("which", [bin], { stdio: "ignore" });
      return bin;
    } catch {
      continue;
    }
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

async function waitUntilReady(timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await health()) return;
    await sleep(200);
  }
  throw new Error("Сервер не поднялся");
}

function childEnv() {
  const vpBin = os.toolchainBin();
  return {
    ...process.env,
    PATH: `${vpBin}:${process.env.PATH ?? "/usr/bin"}`,
  };
}

function run(vp, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(vp, commandArgs, { cwd: ROOT, stdio: "inherit", env: childEnv() });
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
  if (serverMode === "prod" && !existsSync(join(ROOT, "dist", "index.html")))
    await buildFrontend(vp);
}

function startForeground(vp) {
  const child = spawn(vp, serverCommand(readServerMode()), {
    cwd: ROOT,
    stdio: "inherit",
    env: childEnv(),
  });
  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

function startDaemon(vp) {
  mkdirSync(DATA_DIR, { recursive: true });
  const logFd = openSync(join(DATA_DIR, "server.log"), "a");
  const child = spawn(vp, serverCommand(readServerMode()), {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: childEnv(),
  });
  child.unref();
}

/** Меняет режим на диске и, если сервер работает в другом режиме, перезапускает его. */
async function switchMode(target) {
  const info = await serverInfo();
  if (!target) {
    console.log(`режим: ${readServerMode()}`);
    console.log(info ? `сервер: ${info.mode ?? "dev"} (pid ${info.pid})` : "сервер не запущен");
    return;
  }
  if (!isServerMode(target)) throw new Error(`Режим: ${SERVER_MODES.join(" | ")}`);
  const vp = findVp();
  // Сборку делаем до остановки сервера: при ошибке старый процесс и терминалы остаются.
  if (target === "prod") await buildFrontend(vp);
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
  startDaemon(vp);
  await waitUntilReady();
  await openApp({ tray: true });
  console.log(`сервер работает в режиме ${target}`);
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
    await ensureBuilt(vp, readServerMode());
    if (serverOnly) {
      await release();
      startForeground(vp);
      return;
    }

    startDaemon(vp);
    await waitUntilReady();
    await openApp();
  } finally {
    await release();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
