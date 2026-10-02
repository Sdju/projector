import { execFileSync, spawn } from "node:child_process";
import { accessSync, constants, mkdirSync, openSync } from "node:fs";
import { open, readFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const APP_URL = "http://localhost:4177";
const DATA_DIR = join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share"), "projector");
const LOCK_PATH = join(DATA_DIR, "launch.lock");
const serverOnly = process.argv.includes("--server");
const args = process.argv.slice(2);
const modeFlag = args.find((arg) => ["--native", "--window", "--browser"].includes(arg));
const mode = modeFlag?.slice(2);
const toggle = args.includes("toggle") || args.includes("--toggle");
const tray = args.includes("--tray");
const quit = args.includes("quit") || args.includes("--quit");

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
  const candidates = [process.env.VP, join(homedir(), ".vite-plus/bin/vp"), "vp"].filter(Boolean);
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

async function health() {
  try {
    const response = await fetch(`${APP_URL}/api/health`, { signal: AbortSignal.timeout(500) });
    const data = await response.json();
    return Boolean(response.ok && data.ok && data.app === "projector");
  } catch {
    return false;
  }
}

async function openApp() {
  const response = await fetch(`${APP_URL}/api/app/${quit ? "quit" : "open"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, toggle, tray }),
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
  const vpBin = join(homedir(), ".vite-plus/bin");
  return {
    ...process.env,
    PATH: `${vpBin}:${process.env.PATH ?? "/usr/bin"}`,
  };
}

function startForeground(vp) {
  const child = spawn(vp, ["dev"], {
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
  const child = spawn(vp, ["dev"], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: childEnv(),
  });
  child.unref();
}

async function main() {
  const release = await acquireLock();
  try {
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
