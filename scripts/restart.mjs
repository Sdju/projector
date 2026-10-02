import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

async function processIdentity(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return fields[0] === "Z" ? null : fields[19];
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ESRCH") return null;
    throw error;
  }
}

export async function waitForProcessExit(pid, timeoutMs = 15000) {
  const identity = await processIdentity(pid);
  if (identity === null) return;
  const deadline = Date.now() + timeoutMs;
  while ((await processIdentity(pid)) === identity) {
    if (Date.now() >= deadline) throw new Error(`Процесс ${pid} не завершился`);
    await sleep(50);
  }
}

export async function restartAfterExit(serverPid, desktopPid, launch) {
  await Promise.all([
    waitForProcessExit(serverPid),
    desktopPid ? waitForProcessExit(desktopPid) : Promise.resolve(),
  ]);
  await launch();
}

function launchProjector() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("./launch.mjs", import.meta.url)), "--tray"],
      {
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Запуск Projector завершился (${code})`)),
    );
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const serverPid = Number(process.argv[2]);
  const desktopPid = Number(process.argv[3]) || undefined;
  if (!Number.isInteger(serverPid) || serverPid <= 0) throw new Error("Некорректный PID сервера");
  process.send?.("READY");
  process.disconnect?.();
  restartAfterExit(serverPid, desktopPid, launchProjector).catch((error) => {
    console.error("Перезапуск Projector:", error.message);
    process.exitCode = 1;
  });
}
