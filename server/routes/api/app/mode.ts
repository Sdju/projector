import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dataDir } from "../../../../core/modules/app-paths/index.ts";
import { isServerMode } from "../../../../core/modules/server-mode/index.ts";
import { HttpError } from "../../../modules/http/index.ts";
import { terminalRequestAllowed } from "../../../modules/terminal/index.ts";
import { json, readBody } from "../../../modules/transport/index.ts";
import type { RouteContext } from "../../../modules/transport/index.ts";

const host = globalThis as typeof globalThis & { projectorModeSwitch?: boolean };

/**
 * Сборка и перезапуск выполняются отдельным процессом CLI: он переживает остановку
 * этого сервера. Ответ уходит сразу, страница ждёт нового pid через /api/health.
 */
export async function handleAppMode({ req, res, method, path }: RouteContext): Promise<boolean> {
  if (path !== "/api/app/mode" || method !== "POST") return false;
  if (!terminalRequestAllowed(req, false))
    throw new HttpError(403, "Переключение доступно только со страницы Projector");
  const { mode } = (await readBody(req)) as { mode?: unknown };
  if (!isServerMode(mode)) throw new HttpError(400, "Режим: dev или prod");
  if (host.projectorModeSwitch) throw new HttpError(409, "Переключение режима уже выполняется");
  host.projectorModeSwitch = true;
  mkdirSync(dataDir(), { recursive: true });
  const log = openSync(join(dataDir(), "server.log"), "a");
  try {
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("../../../../cli/app/launch.mjs", import.meta.url)), "mode", mode],
      { detached: true, stdio: ["ignore", log, log] },
    );
    child.once("exit", (code) => {
      // Успешное переключение останавливает этот процесс; флаг нужен только при отказе.
      host.projectorModeSwitch = false;
      if (code) console.error(`projector mode ${mode} завершился (${code})`);
    });
    child.unref();
  } catch (error) {
    host.projectorModeSwitch = false;
    throw error;
  } finally {
    closeSync(log);
  }
  json(res, 202, { ok: true });
  return true;
}
