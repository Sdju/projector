import { ref, watch } from "vue";
import {
  commandArgs,
  useCommandRegistrar,
  useCommandScope,
} from "../../../../../common/utilities/commands.ts";
import type { usePagedList } from "./paged-list.ts";

export interface TrackerPanelOptions {
  /** Имя scope и поверхности: `issues` → `issues:<projectId>`, команды `ide.issues.*`. */
  kind: string;
  /** Множественное число для текстов команд: «issues», «pull requests». */
  plural: string;
  /** Единственное число: «issue», «pull request». */
  singular: string;
  /** Что открывает вкладка. */
  opens: string;
  projectId: () => string;
  active: () => boolean;
  list: ReturnType<typeof usePagedList>;
  open: (item: { number: number; title: string }, pinned: boolean) => void;
}

/** Команды `ide.<kind>.*`, раскрытие блока и ленивая загрузка списка для сайдбар-панели. */
export function useTrackerPanel(options: TrackerPanelOptions) {
  const { kind, plural, singular, list } = options;
  const open = ref(true);
  const commands = useCommandScope(`${kind}:${options.projectId()}`, () => ({
    surface: kind,
    projectId: options.projectId(),
  }));
  const register = useCommandRegistrar(commands.scope);
  register(
    `ide.${kind}.block.toggle`,
    `Свернуть или развернуть блок ${plural}`,
    `Показывает или скрывает список ${plural} в сайдбаре.`,
    () => {
      open.value = !open.value;
    },
  );
  register(
    `ide.${kind}.refresh`,
    `Обновить список ${plural}`,
    `Перечитывает первую страницу ${plural} GitHub с текущим фильтром состояния.`,
    () => list.load(),
  );
  register(
    `ide.${kind}.filter`,
    `Отфильтровать ${plural} по состоянию`,
    "Переключает state и перечитывает список.",
    (value) => {
      const { state } = commandArgs(value);
      if (state !== "open" && state !== "closed" && state !== "all")
        throw new Error("Укажите state: open, closed или all");
      return list.filter(state);
    },
    { state: "string: open, closed или all" },
  );
  register(
    `ide.${kind}.more`,
    `Показать следующую страницу ${plural}`,
    `Догружает следующую страницу ${plural} текущего фильтра (по 30).`,
    () => list.more(),
  );
  register(
    `ide.${kind}.open`,
    `Открыть ${singular}`,
    `Открывает вкладку выбранного ${singular}: ${options.opens}.`,
    (value) => {
      const { number, title, pinned } = commandArgs(value);
      if (typeof number !== "number") throw new Error(`Укажите номер ${singular}`);
      options.open({ number, title: typeof title === "string" ? title : "" }, pinned === true);
    },
    {
      number: `number: номер ${singular}`,
      title: "string (необязательно): заголовок вкладки",
      pinned: "boolean (необязательно): true — постоянная вкладка вместо временной",
    },
  );
  let loaded = false;
  watch(
    options.active,
    (active) => {
      if (!active || loaded) return;
      loaded = true;
      void list.load();
    },
    { immediate: true },
  );
  // Смена проекта пересоздаёт панель; защита от устаревших запросов внутри списка.
  watch(options.projectId, () => {
    loaded = false;
    list.reset();
  });
  return { commands, open };
}
