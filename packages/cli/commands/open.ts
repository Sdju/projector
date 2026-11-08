import type { CliOptions } from "../modules/arguments/index.ts";
import type { AppOpenResult, ProjectorApi } from "../modules/api/index.ts";
import { writeJson, type Output } from "../common/output.ts";
import { resolveOpenTarget } from "../modules/projects/index.ts";

export async function commandOpen(
  api: ProjectorApi,
  options: CliOptions,
  target: string | undefined,
  out: Output,
): Promise<unknown> {
  if (!target) {
    if (options.tray) {
      const result = await api.open({ tray: true });
      if (options.json) writeJson(out, result);
      else if (!options.quiet) out("Projector работает в трее");
      return result;
    }
    const result = await api.open({ mode: options.mode });
    if (options.json) writeJson(out, result);
    else if (!options.quiet) out(`Projector открыт: ${result.url ?? api.baseUrl}`);
    return result;
  }
  if (options.tray) throw new Error("--tray используется без проекта");
  const id = await resolveOpenTarget(api, target);
  const launched = await api.launch({ id, action: "open", inline: true });
  if (!launched.route) throw new Error("Сервер не вернул маршрут проекта");
  const opened = await api.open({ route: launched.route, mode: options.mode });
  const result = { ...launched, ...opened, id };
  if (options.json) writeJson(out, result);
  else if (!options.quiet) out(`Открыт проект: ${opened.url}`);
  return result;
}

export async function commandToggle(
  api: ProjectorApi,
  options: CliOptions,
  out: Output,
): Promise<AppOpenResult> {
  const result = await api.open({ toggle: true, mode: options.mode });
  if (options.json) writeJson(out, result);
  else if (!options.quiet) out("Палитра переключена");
  return result;
}

export async function commandSettings(
  api: ProjectorApi,
  options: CliOptions,
  out: Output,
): Promise<AppOpenResult> {
  const result = await api.open({ route: "/settings", mode: options.mode });
  if (options.json) writeJson(out, result);
  else if (!options.quiet) out(`Открыты настройки: ${result.url}`);
  return result;
}
