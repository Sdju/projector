import { computed, inject, onBeforeUnmount, provide, ref, watch, type InjectionKey } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import {
  inspectCommands,
  missingCommands,
  projectDraft,
  settingsError,
  useProjects,
} from "../../project/index.ts";
import type { Project, ProjectCommand } from "../../project/index.ts";

/**
 * Состояние формы настроек проекта. Разделы лежат в разных компонентах рабочей области настроек,
 * но редактируют один черновик и сохраняются вместе: форма раздаёт состояние через provide.
 */
export function createProjectSettingsForm(
  project: () => Project,
  options: { afterRemove: () => unknown; onDirty: (value: boolean) => void },
) {
  const catalog = useProjects();
  const draft = ref(projectDraft(project()));
  const baseline = ref(JSON.stringify(draft.value));
  const dirty = computed(() => JSON.stringify(draft.value) !== baseline.value);
  const busy = ref(false);
  const discovering = ref(false);
  const error = ref("");
  const notice = ref("");
  const discovered = ref<ProjectCommand[] | null>(null);
  const candidates = computed(() => missingCommands(draft.value.commands, discovered.value ?? []));
  const selected = ref<string[]>([]);
  const validation = computed(() => settingsError(draft.value));

  watch(
    dirty,
    (value) => {
      if (value) notice.value = "";
      options.onDirty(value);
    },
    { immediate: true },
  );
  watch(project, (next) => {
    if (!dirty.value && !busy.value && JSON.stringify(projectDraft(next)) !== baseline.value)
      reset(next);
  });

  function reset(source = project()) {
    draft.value = projectDraft(source);
    baseline.value = JSON.stringify(draft.value);
    error.value = "";
    notice.value = "";
    discovered.value = null;
    selected.value = [];
  }
  function canLeave() {
    return (
      !busy.value && (!dirty.value || window.confirm("Закрыть настройки без сохранения изменений?"))
    );
  }
  onBeforeRouteLeave(canLeave);
  onBeforeRouteUpdate((to, from) => to.path === from.path || canLeave());
  function beforeUnload(event: BeforeUnloadEvent) {
    if (!dirty.value) return;
    event.preventDefault();
    event.returnValue = "";
  }
  window.addEventListener("beforeunload", beforeUnload);
  onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload));

  function addCommand() {
    draft.value.commands.push({ id: crypto.randomUUID(), name: "", cmd: "" });
  }
  function removeCommand(id: string) {
    if (draft.value.commands.length <= 1) return;
    draft.value.commands = draft.value.commands.filter((command) => command.id !== id);
    if (draft.value.defaultCommandId === id)
      draft.value.defaultCommandId = draft.value.commands[0]!.id;
  }
  async function discover() {
    discovering.value = true;
    error.value = "";
    try {
      discovered.value = (await inspectCommands(project().path)).commands;
      selected.value = candidates.value.map((command) => command.id);
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Не удалось прочитать команды";
    } finally {
      discovering.value = false;
    }
  }
  function importCommands() {
    draft.value.commands.push(
      ...candidates.value.filter((command) => selected.value.includes(command.id)),
    );
    discovered.value = null;
    selected.value = [];
  }
  async function save() {
    if (busy.value || !dirty.value) return;
    error.value = validation.value;
    if (error.value) return;
    busy.value = true;
    try {
      const saved = await catalog.save(project().id, {
        ...draft.value,
        name: draft.value.name.trim(),
        url: draft.value.url.trim(),
        icon: draft.value.icon.trim(),
        commands: draft.value.commands.map((command) => ({
          ...command,
          name: command.name.trim(),
          cmd: command.cmd.trim(),
        })),
      });
      reset(saved);
      notice.value = "Настройки сохранены";
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Не удалось сохранить настройки";
    } finally {
      busy.value = false;
    }
  }
  async function remove() {
    if (
      busy.value ||
      !window.confirm(
        `Убрать «${project().name}» из Projector? Терминалы и запущенные процессы проекта будут завершены. Файлы останутся на диске.`,
      )
    )
      return;
    busy.value = true;
    error.value = "";
    try {
      await catalog.remove(project().id);
      baseline.value = JSON.stringify(draft.value);
      await options.afterRemove();
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Не удалось убрать проект";
    } finally {
      busy.value = false;
    }
  }
  const form = {
    project,
    draft,
    dirty,
    busy,
    discovering,
    error,
    notice,
    discovered,
    candidates,
    selected,
    validation,
    reset,
    canLeave,
    addCommand,
    removeCommand,
    discover,
    importCommands,
    save,
    remove,
  };
  provide(projectSettingsFormKey, form);
  return form;
}

export type ProjectSettingsForm = ReturnType<typeof createProjectSettingsForm>;
const projectSettingsFormKey: InjectionKey<ProjectSettingsForm> = Symbol("project-settings-form");
export function useProjectSettingsForm(): ProjectSettingsForm {
  const form = inject(projectSettingsFormKey);
  if (!form) throw new Error("Раздел настроек проекта вне формы");
  return form;
}
