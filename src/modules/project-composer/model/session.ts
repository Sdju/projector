import { computed, reactive } from "vue";
import { looksLikePath } from "../../../common/utilities/looks-like-path.ts";
import { agentMessageForPaths } from "../../path-drop/index.ts";
import { useAgent } from "../../agent/index.ts";
import { inspectPath, pickFolder, useProjects } from "../../project/index.ts";
import type { Project, ProjectDraft } from "../../project/index.ts";

const state = reactive({
  query: "",
  preview: null as ProjectDraft | null,
  existing: null as Project | null,
  advanced: false,
  loading: false,
  picking: false,
  error: "",
  notice: "",
  fallbackPath: "",
});

let noticeTimer = 0;

function flash(text: string): void {
  state.notice = text;
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    state.notice = "";
  }, 2200);
}

export function useAddSession() {
  const catalog = useProjects();
  const agent = useAgent();

  const query = computed({
    get: () => state.query,
    set: (value: string) => {
      state.query = value;
    },
  });
  const preview = computed(() => state.preview);
  const existing = computed(() => state.existing);
  const advanced = computed({
    get: () => state.advanced,
    set: (value: boolean) => {
      state.advanced = value;
    },
  });
  const loading = computed(() => state.loading);
  const picking = computed(() => state.picking);
  const error = computed(() => state.error);
  const notice = computed(() => state.notice);
  const fallbackPath = computed(() => state.fallbackPath);
  const busy = computed(() => state.loading || state.picking || agent.busy.value);

  function resetPreview(): void {
    state.preview = null;
    state.existing = null;
    state.advanced = false;
    state.fallbackPath = "";
    state.error = "";
  }

  function cancel(): void {
    resetPreview();
    state.query = "";
  }

  async function fromPath(path: string): Promise<void> {
    const trimmed = path.trim();
    if (!trimmed || state.loading) return;
    state.loading = true;
    state.error = "";
    state.fallbackPath = "";
    state.query = trimmed;
    try {
      const inspected = await inspectPath(trimmed);
      const already = catalog.projects.value.find((item) => item.path === inspected.path) ?? null;
      state.existing = already;
      state.preview = already
        ? {
            name: already.name,
            path: already.path,
            url: already.url,
            icon: already.icon,
            mode: already.mode,
            defaultCommandId: already.defaultCommandId,
            commands: already.commands.map((command) => ({ ...command })),
          }
        : inspected;
      state.advanced = false;
    } catch (err) {
      state.preview = null;
      state.existing = null;
      state.fallbackPath = trimmed;
      state.error = err instanceof Error ? err.message : "Не удалось прочитать проект";
    } finally {
      state.loading = false;
    }
  }

  async function fromPaths(paths: string[]): Promise<void> {
    if (!paths.length) {
      state.error = "Не удалось прочитать путь. Перетащите папку из файлового менеджера.";
      return;
    }
    if (agent.busy.value) {
      state.error = "Агент ещё работает — подождите ответа.";
      return;
    }
    if (paths.length === 1) {
      await fromPath(paths[0]);
      return;
    }
    resetPreview();
    await agent.send(agentMessageForPaths(paths));
  }

  async function pick(): Promise<void> {
    if (state.loading || state.picking || agent.busy.value) return;
    state.error = "";
    state.picking = true;
    try {
      const picked = await pickFolder();
      if (picked.cancelled || !picked.path) return;
      await fromPath(picked.path);
    } catch (err) {
      state.error = err instanceof Error ? err.message : "Не удалось выбрать папку";
    } finally {
      state.picking = false;
    }
  }

  async function submitQuery(): Promise<void> {
    const text = state.query.trim();
    if (state.preview && (!text || text === state.preview.path) && !state.existing) {
      await confirm();
      return;
    }
    if (!text) return;
    if (looksLikePath(text)) {
      await fromPath(text);
      return;
    }
    resetPreview();
    await agent.send(text);
    state.query = "";
  }

  async function askAgentAboutFallback(): Promise<void> {
    const path = state.fallbackPath;
    if (!path || agent.busy.value) return;
    state.error = "";
    await agent.send(`найди и добавь приложения в ${path}`);
  }

  async function confirm(): Promise<Project | null> {
    if (!state.preview || state.existing || state.loading) return null;
    state.loading = true;
    state.error = "";
    try {
      const project = await catalog.add(state.preview);
      flash(`добавлен ${project.name}`);
      cancel();
      return project;
    } catch (err) {
      state.error = err instanceof Error ? err.message : "Не удалось сохранить";
      return null;
    } finally {
      state.loading = false;
    }
  }

  function patchPreview(next: ProjectDraft): void {
    state.preview = next;
  }

  return {
    query,
    preview,
    existing,
    advanced,
    loading,
    picking,
    error,
    notice,
    fallbackPath,
    busy,
    cancel,
    fromPath,
    fromPaths,
    pick,
    submitQuery,
    askAgentAboutFallback,
    confirm,
    patchPreview,
  };
}
