import { spawn } from "node:child_process";
import { os } from "../../core/modules/os/index.ts";
import { fileURLToPath } from "node:url";

export const waitForProcessExit = (pid, timeoutMs = 15000) =>
  os.processes.waitForExit(pid, timeoutMs);

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
