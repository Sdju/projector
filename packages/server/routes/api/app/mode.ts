import { spawn } from "node:child_process";
import { closeSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dataDir, openLog, serverLogPath } from "@projector/core/modules/app-paths/index.ts";
import { isServerMode } from "@projector/core/modules/server-mode/index.ts";
import { HttpError } from "../../../modules/http/index.ts";
import { isLocalRequest } from "../../../modules/access/index.ts";
import { json, readBody, type RouteDefinition } from "../../../modules/transport/index.ts";

const host = globalThis as typeof globalThis & { projectorModeSwitch?: boolean };

/**
 * Сборка и перезапуск выполняются отдельным процессом CLI: он переживает остановку
 * этого сервера. Ответ уходит сразу, страница ждёт нового pid через /api/health.
 */
export const routes: RouteDefinition[] = [
  {
    method: "POST",
    path: "/api/app/mode",
    handler: async ({ req, res }) => {
      if (!isLocalRequest(req))
        throw new HttpError(403, "Переключение доступно только с локальной машины");
      const { mode } = (await readBody(req)) as { mode?: unknown };
      if (!isServerMode(mode)) throw new HttpError(400, "Режим: dev или prod");
      if (host.projectorModeSwitch) throw new HttpError(409, "Переключение режима уже выполняется");
      host.projectorModeSwitch = true;
      mkdirSync(dataDir(), { recursive: true });
      const log = openLog(serverLogPath(), { rotate: false });
      try {
        const child = spawn(
          process.execPath,
          [fileURLToPath(new URL("../../../../cli/app/launch.ts", import.meta.url)), "mode", mode],
          { detached: true, stdio: ["ignore", log, log], windowsHide: true },
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
    },
  },
];
