import { ref, watch } from "vue";
import {
  commandArgs,
  useCommandRegistrar,
  useCommandScope,
} from "../../../../../common/utilities/commands.ts";
import type { useReleases } from "./releases.ts";

export interface ReleasesPanelOptions {
  projectId: () => string;
  active: () => boolean;
  list: ReturnType<typeof useReleases>;
  open: (release: { tag: string; title?: string }, pinned: boolean) => void;
}

/** Commands `ide.releases.*`, block state and lazy first-page loading of the sidebar section. */
export function useReleasesPanel(options: ReleasesPanelOptions) {
  const { list } = options;
  const open = ref(true);
  const commands = useCommandScope(`releases:${options.projectId()}`, () => ({
    surface: "releases",
    projectId: options.projectId(),
  }));
  const register = useCommandRegistrar(commands.scope);
  register(
    "ide.releases.block.toggle",
    "Свернуть или развернуть блок releases",
    "Показывает или скрывает список релизов в сайдбаре.",
    () => {
      open.value = !open.value;
    },
  );
  register(
    "ide.releases.refresh",
    "Обновить список релизов",
    "Перечитывает первую страницу релизов.",
    () => list.load(),
  );
  register(
    "ide.releases.more",
    "Показать следующую страницу релизов",
    "Догружает следующую страницу релизов (по 30).",
    () => list.more(),
  );
  register(
    "ide.releases.open",
    "Открыть релиз",
    "Открывает вкладку релиза: описание, ссылки и скачиваемые файлы.",
    (value) => {
      const { tag, title, pinned } = commandArgs(value);
      if (typeof tag !== "string" || !tag.trim()) throw new Error("Укажите тег релиза");
      options.open(
        { tag: tag.trim(), title: typeof title === "string" ? title : "" },
        pinned === true,
      );
    },
    {
      tag: "string: тег релиза",
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
  watch(options.projectId, () => {
    loaded = false;
    list.reset();
  });
  return { commands, open };
}
