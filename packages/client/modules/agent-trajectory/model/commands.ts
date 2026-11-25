/** Agent-facing commands that open a trajectory document as a tab or in the right panel. */

import { commandArgs } from "../../../common/utilities/commands.ts";
import {
  focusTrajectoryDocument,
  latestTrajectoryDocument,
  putTrajectoryDocument,
} from "./store.ts";
import type { TrajectoryDocumentOptions } from "./types.ts";

type Register = (
  id: string,
  title: string,
  run: (args?: unknown) => unknown,
  enabled: (args?: unknown) => boolean,
  requires?: undefined,
  meta?: { description?: string; arguments?: Record<string, string> },
) => unknown;

export interface TrajectoryCommandHost {
  register: Register;
  openTab: (id: string, params?: Record<string, unknown>, options?: { preview?: boolean }) => void;
  /** Enables and selects the right-panel section, then shows it. */
  showPanel: (id: string) => void;
  /** The right panel is unavailable on a phone; open the tab instead. */
  mobile: () => boolean;
}

function hasPayload(args: Record<string, unknown>): boolean {
  return ["data", "document", "format", "version", "turns", "records"].some(
    (key) => args[key] !== undefined,
  );
}

function documentOf(args: Record<string, unknown>) {
  const payload = args.document ?? args.data ?? args;
  const options: TrajectoryDocumentOptions = {
    ...(typeof args.id === "string" && args.id ? { id: args.id } : {}),
    ...(typeof args.title === "string" && args.title ? { title: args.title } : {}),
    ...(typeof args.subtitle === "string" && args.subtitle ? { subtitle: args.subtitle } : {}),
    source: "command",
  };
  return putTrajectoryDocument(payload, options);
}

function readDocument(args: Record<string, unknown>) {
  if (hasPayload(args)) return documentOf(args);
  const id = typeof args.id === "string" && args.id ? args.id : undefined;
  if (id) {
    const document = focusTrajectoryDocument(id);
    if (!document) throw new Error(`Документ траектории не найден: ${id}`);
    return document;
  }
  const latest = latestTrajectoryDocument().value;
  if (!latest)
    throw new Error("Нет данных траектории: передайте data или откройте .trajectory.json");
  return latest;
}

const ARGUMENTS: Record<string, string> = {
  data: "Объект траектории: { turns?, records?, counts?, usage?, capabilities?, notice? } или JSON-строка",
  document: "Готовый документ: { title?, subtitle?, data }",
  title: "Заголовок вкладки или панели",
  subtitle: "Короткое пояснение под заголовком",
  id: "Идентификатор документа; повторный вызов с тем же id обновляет его",
};

/** Registers `ide.trajectory.open` (dock tab) and `ide.trajectory.panel` (right panel). */
export function registerTrajectoryCommands(host: TrajectoryCommandHost): void {
  host.register(
    "ide.trajectory.open",
    "Открыть траекторию во вкладке",
    (value) => {
      const document = readDocument(commandArgs(value));
      host.openTab("trajectory", { id: document.id, title: document.title }, { preview: false });
      return { id: document.id, title: document.title, surface: "tab" };
    },
    () => true,
    undefined,
    {
      description:
        "Открывает вкладку с траекторией агента: обзорная шкала, журнал ходов и инспектор записи. Данные передаются аргументом data или готовым документом; без data открывается последний документ. Поддерживаются записи user, assistant, thought, tool, subtool, task, note, judge, context, system и compaction; поля, которых нет, панель честно помечает как недоступные. Данные живут в памяти страницы до перезагрузки. Файл .trajectory.json открывается как вкладка через ide.editor.path.open.",
      arguments: ARGUMENTS,
    },
  );
  host.register(
    "ide.trajectory.panel",
    "Открыть траекторию в правой панели",
    (value) => {
      const document = readDocument(commandArgs(value));
      if (host.mobile()) {
        host.openTab("trajectory", { id: document.id, title: document.title }, { preview: false });
        return { id: document.id, title: document.title, surface: "tab" };
      }
      host.showPanel(document.id);
      return { id: document.id, title: document.title, surface: "panel" };
    },
    () => true,
    undefined,
    {
      description:
        "Показывает ту же траекторию в правой панели workspace и включает эту панель для проекта. Данные передаются так же, как в ide.trajectory.open; без data открывается последний документ. На телефоне открывается вкладка, потому что правой панели нет.",
      arguments: ARGUMENTS,
    },
  );
}
