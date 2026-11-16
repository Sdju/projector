import { computed, ref, useId } from "vue";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import {
  createAgentPreset,
  readAgentPresets,
  removeAgentPreset,
  setAgentPresetTrust,
  writeAgentPreset,
} from "../api.ts";
import type {
  AgentPreset,
  AgentPresetBundle,
  AgentPresetDraft,
  AgentPresetSource,
} from "@ai-projector/core/modules/agent-preset/index.ts";

const NEW_PRESET: AgentPresetDraft = {
  title: "Новый пресет",
  prompt: "Помоги с задачей в этом проекте.",
};

/**
 * One preset file at a time: the user's settings page edits the global file, the project page
 * edits `.projector/presets.json`. The start screen combines them elsewhere.
 */
export function useAgentPresetSettings(options: { projectId?: () => string } = {}) {
  const data = ref<AgentPresetBundle>();
  const busy = ref("");
  const error = ref("");
  const source = computed<AgentPresetSource>(() => (options.projectId?.() ? "project" : "global"));
  const projectState = computed(() =>
    source.value === "project" ? data.value?.project : undefined,
  );
  const presets = computed<AgentPreset[]>(() =>
    source.value === "project" ? (projectState.value?.presets ?? []) : (data.value?.presets ?? []),
  );
  const trusted = computed(() => projectState.value?.trusted === true);
  const exists = computed(() => projectState.value?.exists === true);
  const file = computed(() =>
    source.value === "project" ? (projectState.value?.file ?? "") : (data.value?.file ?? ""),
  );
  const problem = computed(() => projectState.value?.problem ?? "");
  const message = computed(() => error.value || problem.value);
  const commands = useCommandScope(`agent-presets:${useId()}`, () => ({
    surface: "agentPresets",
    projectId: options.projectId?.() ?? "",
    scope: source.value,
    trusted: trusted.value,
    presets: presets.value.length,
    busy: busy.value,
  }));

  async function perform<T>(action: () => Promise<T>): Promise<T> {
    error.value = "";
    try {
      return await action();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "Ошибка пресетов агента";
      throw cause;
    }
  }

  async function load(): Promise<AgentPresetBundle> {
    return perform(async () => {
      data.value = await readAgentPresets(options.projectId?.());
      return data.value;
    });
  }

  async function create(preset: AgentPresetDraft = NEW_PRESET): Promise<AgentPresetBundle> {
    busy.value = "new";
    try {
      return await perform(async () => {
        data.value = await createAgentPreset(
          preset,
          source.value === "project" ? options.projectId?.() : undefined,
        );
        return data.value;
      });
    } finally {
      busy.value = "";
    }
  }

  async function save(id: string, preset: AgentPresetDraft): Promise<AgentPresetBundle> {
    busy.value = id;
    try {
      return await perform(async () => {
        data.value = await writeAgentPreset(
          id,
          preset,
          source.value === "project" ? options.projectId?.() : undefined,
        );
        return data.value;
      });
    } finally {
      busy.value = "";
    }
  }

  async function remove(id: string): Promise<AgentPresetBundle> {
    busy.value = id;
    try {
      return await perform(async () => {
        data.value = await removeAgentPreset(
          id,
          source.value === "project" ? options.projectId?.() : undefined,
        );
        return data.value;
      });
    } finally {
      busy.value = "";
    }
  }

  async function trust(value: boolean): Promise<AgentPresetBundle> {
    const projectId = options.projectId?.();
    if (!projectId) throw new Error("Доверие есть только у пресетов проекта");
    busy.value = "trust";
    try {
      return await perform(async () => {
        data.value = await setAgentPresetTrust(projectId, value);
        return data.value;
      });
    } finally {
      busy.value = "";
    }
  }

  commands.scope.registerCommand({
    id: "ide.agent.presets.settings.list",
    palette: false,
    title: "Пресеты на этой странице",
    description:
      "Возвращает пресеты, которые редактирует открытая страница: глобальные или пресеты проекта. Включает путь к файлу, признак доверия и ошибку чтения.",
    run: () => load(),
  });
  commands.scope.registerCommand({
    id: "ide.agent.presets.settings.create",
    palette: false,
    title: "Добавить пресет",
    description:
      "Создаёт пресет в файле открытой страницы. Дальше название, текст и форму меняет ide.agent.presets.settings.save.",
    run: () => create(),
  });
  commands.scope.registerCommand({
    id: "ide.agent.presets.settings.save",
    palette: false,
    title: "Сохранить пресет",
    description:
      "Меняет пресет открытой страницы: название, описание, prompt и необязательную Vue-разметку формы. Пустая строка form убирает форму. Любая запись в файл проекта отзывает доверие к нему.",
    arguments: {
      preset: "string: id пресета",
      title: "string: название",
      prompt: "string: текст запроса",
      description: "string: описание",
      form: "string: Vue-разметка формы; пустая строка убирает",
    },
    enabled: () => !busy.value,
    run: (value) => {
      const args = commandArgs(value);
      const id = typeof args.preset === "string" ? args.preset : "";
      if (!id) throw new Error("preset: id пресета");
      const known = presets.value.find((preset) => preset.id === id);
      if (!known) throw new Error(`Неизвестный пресет: ${id}`);
      return save(id, {
        title: typeof args.title === "string" ? args.title : known.title,
        prompt: typeof args.prompt === "string" ? args.prompt : known.prompt,
        ...(typeof args.description === "string"
          ? { description: args.description }
          : known.description
            ? { description: known.description }
            : {}),
        ...(typeof args.form === "string"
          ? args.form.trim()
            ? { form: args.form }
            : {}
          : known.form
            ? { form: known.form }
            : {}),
      });
    },
  });
  commands.scope.registerCommand({
    id: "ide.agent.presets.settings.delete",
    palette: false,
    title: "Удалить пресет",
    description: "Удаляет пресет из файла открытой страницы. Открытые чаты не меняются.",
    arguments: { preset: "string: id пресета" },
    enabled: () => !busy.value,
    run: (value) => {
      const args = commandArgs(value);
      const id = typeof args.preset === "string" ? args.preset : "";
      if (!id) throw new Error("preset: id пресета");
      return remove(id);
    },
  });
  commands.scope.registerCommand({
    id: "ide.agent.presets.settings.trust",
    palette: false,
    title: "Доверие к пресетам проекта",
    description:
      "Доверяет текущему содержимому .projector/presets.json или отзывает доверие. Без доверия пресеты проекта не появляются на стартовом экране агента.",
    arguments: { trusted: "boolean: доверять ли текущему файлу" },
    enabled: () => source.value === "project" && !busy.value,
    run: (value) => trust(commandArgs(value).trusted !== false),
  });

  return {
    data,
    presets,
    trusted,
    exists,
    file,
    problem,
    busy,
    error: message,
    load,
    create,
    save,
    remove,
    trust,
    commands,
  };
}
