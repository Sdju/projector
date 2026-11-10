import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { os } from "@projector-ai/core/modules/os/index.ts";

export const waitForProcessExit = (pid: number, timeoutMs = 15000): Promise<void> =>
  os.processes.waitForExit(pid, timeoutMs);

export async function restartAfterExit(
  serverPid: number,
  desktopPid: number | undefined,
  launch: () => Promise<void>,
): Promise<void> {
  await Promise.all([
    waitForProcessExit(serverPid),
    desktopPid ? waitForProcessExit(desktopPid) : Promise.resolve(),
  ]);
  await launch();
}

function launchProjector(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("./launch.ts", import.meta.url)), "--tray"],
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
  restartAfterExit(serverPid, desktopPid, launchProjector).catch((error: unknown) => {
    console.error("Перезапуск Projector:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
