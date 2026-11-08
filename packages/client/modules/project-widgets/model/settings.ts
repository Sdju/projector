import { computed, ref, useId } from "vue";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import { loadProjectWidgets, trustProjectWidgets, type ProjectWidgetState } from "../api.ts";

/** Widgets stored in `.projector/widgets.json`, their trust decision and what the file declares. */
export function useProjectWidgetSettings(projectId: () => string) {
  const data = ref<ProjectWidgetState>();
  const busy = ref("");
  const error = ref("");
  const commands = useCommandScope(`project-widgets:${useId()}`, () => ({
    surface: "projectWidgets",
    projectId: projectId(),
    trusted: data.value?.trusted === true,
    widgets: data.value?.widgets.length ?? 0,
    busy: busy.value,
  }));

  const widgets = computed(() => data.value?.widgets ?? []);
  const trusted = computed(() => data.value?.trusted === true);
  const file = computed(() => data.value?.file ?? "");
  const exists = computed(() => data.value?.exists === true);
  const problem = computed(() => data.value?.problem ?? "");
  const message = computed(() => error.value || problem.value);

  async function perform<T>(action: () => Promise<T>): Promise<T> {
    error.value = "";
    try {
      return await action();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "Ошибка виджетов проекта";
      throw cause;
    }
  }

  async function load(): Promise<ProjectWidgetState | undefined> {
    const id = projectId();
    if (!id) {
      data.value = undefined;
      return undefined;
    }
    return perform(async () => {
      data.value = await loadProjectWidgets(id);
      return data.value;
    });
  }

  async function trust(value: boolean): Promise<ProjectWidgetState> {
    const id = projectId();
    busy.value = "trust";
    try {
      return await perform(async () => {
        data.value = await trustProjectWidgets(id, value);
        return data.value;
      });
    } finally {
      busy.value = "";
    }
  }

  commands.scope.registerCommand({
    id: "ide.project.widgets.list",
    palette: false,
    title: "Виджеты проекта",
    description:
      "Возвращает виджеты из .projector/widgets.json, путь к файлу, признак доверия и ошибку чтения. Недоверенный файл не попадает ни в промпт, ни в ответы.",
    run: async () => {
      await load();
      const state = data.value ?? {
        projectId: projectId(),
        path: "",
        file: "",
        exists: false,
        trusted: false,
        widgets: [],
      };
      return {
        ...state,
        widgets: state.widgets.map(({ template: _template, styles: _styles, ...widget }) => widget),
      };
    },
  });
  commands.scope.registerCommand({
    id: "ide.project.widgets.trust",
    palette: false,
    title: "Доверять виджетам проекта",
    description:
      "Выдаёт или отзывает доверие к текущему содержимому .projector/widgets.json. Доверие привязано к хешу файла: правка файла отзывает его автоматически.",
    arguments: { trusted: "boolean: доверять ли текущему файлу" },
    enabled: () => !busy.value,
    run: (value) => {
      const trusted = commandArgs(value).trusted;
      if (typeof trusted !== "boolean") throw new Error("trusted должен быть boolean");
      return trust(trusted);
    },
  });

  return {
    data,
    widgets,
    trusted,
    file,
    exists,
    problem,
    busy,
    error: message,
    load,
    trust,
    commands,
  };
}
