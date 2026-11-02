import { ref, watch } from "vue";
import {
  commandArgs,
  useCommandRegistrar,
  useCommandScope,
} from "../../../../../common/utilities/commands.ts";
import { PIPELINE_FILTERS, type PipelineFilter, type usePipelines } from "./pipelines.ts";

export interface PipelinesPanelOptions {
  projectId: () => string;
  active: () => boolean;
  list: ReturnType<typeof usePipelines>;
  open: (pipeline: { id: number; title?: string }, pinned: boolean) => void;
}

/** Commands `ide.pipelines.*`, block state and lazy first-page loading of the sidebar section. */
export function usePipelinesPanel(options: PipelinesPanelOptions) {
  const { list } = options;
  const open = ref(true);
  const commands = useCommandScope(`pipelines:${options.projectId()}`, () => ({
    surface: "pipelines",
    projectId: options.projectId(),
  }));
  const register = useCommandRegistrar(commands.scope);
  register(
    "ide.pipelines.block.toggle",
    "Свернуть или развернуть блок pipelines",
    "Показывает или скрывает список pipelines в сайдбаре.",
    () => {
      open.value = !open.value;
    },
  );
  register(
    "ide.pipelines.refresh",
    "Обновить список pipelines",
    "Перечитывает первую страницу pipelines GitLab с текущим фильтром статуса.",
    () => list.load(),
  );
  register(
    "ide.pipelines.filter",
    "Отфильтровать pipelines по статусу",
    "Переключает статус и перечитывает список.",
    (value) => {
      const { status } = commandArgs(value);
      if (!PIPELINE_FILTERS.some((item) => item.value === status) && status !== "canceled")
        throw new Error("Укажите status: all, running, success, failed или canceled");
      return list.filter(status as PipelineFilter);
    },
    { status: "string: all, running, success, failed или canceled" },
  );
  register(
    "ide.pipelines.more",
    "Показать следующую страницу pipelines",
    "Догружает следующую страницу pipelines текущего фильтра (по 30).",
    () => list.more(),
  );
  register(
    "ide.pipelines.open",
    "Открыть pipeline",
    "Открывает вкладку выбранного pipeline: статус, ветка, коммит и джобы.",
    (value) => {
      const { id, title, pinned } = commandArgs(value);
      if (typeof id !== "number") throw new Error("Укажите номер pipeline");
      options.open({ id, title: typeof title === "string" ? title : "" }, pinned === true);
    },
    {
      id: "number: номер pipeline",
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
