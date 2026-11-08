import { writeJson, type Output } from "../common/output.ts";
import type { CliOptions } from "../modules/arguments/index.ts";
import type { HealthInfo, ProjectorApi } from "../modules/api/index.ts";
import { serverLine, waitForHealth, waitUntilDown } from "../modules/command-runtime/index.ts";

export interface QuitResult {
  ok: boolean;
  running: boolean;
  pid?: number;
}

export async function commandRestart(
  api: ProjectorApi,
  options: CliOptions,
  out: Output,
): Promise<HealthInfo> {
  const info = await api.health();
  if (!info) throw new Error("Projector не запущен. Запустите: projector start");
  const oldPid = info.pid;
  await api.app("restart");
  const next = await waitForHealth(
    api,
    (current) => current.pid !== oldPid,
    60_000,
    "Сервер не перезапустился за 60 секунд. Смотрите: projector logs",
  );
  if (options.json) writeJson(out, { server: next, previousPid: oldPid });
  else if (!options.quiet) out(`Projector перезапущен · ${serverLine(next)}`);
  return next;
}

export async function commandQuit(
  api: ProjectorApi,
  options: CliOptions,
  out: Output,
): Promise<QuitResult> {
  const info = await api.health();
  if (!info) {
    if (options.json) writeJson(out, { ok: true, running: false });
    else if (!options.quiet) out("Projector не запущен");
    return { ok: true, running: false };
  }
  await api.app("quit");
  await waitUntilDown(api, 15_000, "Сервер не завершился за 15 секунд");
  if (options.json) writeJson(out, { ok: true, running: false, pid: info.pid });
  else if (!options.quiet) out("Projector остановлен");
  return { ok: true, running: false, pid: info.pid };
}
