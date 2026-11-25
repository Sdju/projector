import { computed, ref } from "vue";
import { refreshClientAgents } from "../../agents-integration/catalog/index.ts";
import { refreshPluginRuntime } from "../../plugin-runtime/index.ts";
import type { PluginInfo } from "../../plugins/index.ts";
import { fetchProjectPlugins, projectPluginAction, type ProjectPluginAction } from "../api.ts";

/**
 * `.projector/plugins` for one project. The repository declares packages; trust and the final
 * enable decision belong to this device, so a clone never starts code by itself.
 */
export function useProjectPluginSettings(projectId: () => string) {
  const plugins = ref<PluginInfo[]>([]);
  const loaded = ref(false);
  const busy = ref("");
  const error = ref("");

  const trusted = computed(() => plugins.value.filter((plugin) => plugin.trusted).length);
  const enabled = computed(() => plugins.value.filter((plugin) => plugin.enabled).length);

  async function perform<T>(id: string, action: () => Promise<T>): Promise<T> {
    busy.value = id;
    error.value = "";
    try {
      return await action();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "Ошибка плагинов проекта";
      throw cause;
    } finally {
      busy.value = "";
    }
  }

  function accept(next: PluginInfo[]): PluginInfo[] {
    plugins.value = next;
    loaded.value = true;
    return next;
  }

  async function load(): Promise<PluginInfo[]> {
    const id = projectId();
    if (!id) {
      plugins.value = [];
      loaded.value = false;
      return [];
    }
    return perform("", async () => accept(await fetchProjectPlugins(id)));
  }

  async function act(action: ProjectPluginAction, id: string): Promise<PluginInfo[]> {
    const project = projectId();
    if (!project) throw new Error("Проект не открыт");
    return perform(id, async () => {
      const next = accept(await projectPluginAction(project, action, id));
      await Promise.all([
        refreshPluginRuntime().catch(() => undefined),
        refreshClientAgents(project).catch(() => undefined),
      ]);
      return next;
    });
  }

  function trust(id: string, value: boolean): Promise<PluginInfo[]> {
    return act(value ? "trust" : "untrust", id);
  }

  function setEnabled(id: string, value: boolean): Promise<PluginInfo[]> {
    return act(value ? "enable" : "disable", id);
  }

  function refresh(): Promise<PluginInfo[]> {
    const project = projectId();
    if (!project) return load();
    return perform("refresh", async () => {
      const next = accept(await projectPluginAction(project, "refresh"));
      await Promise.all([
        refreshPluginRuntime().catch(() => undefined),
        refreshClientAgents(project).catch(() => undefined),
      ]);
      return next;
    });
  }

  return {
    plugins,
    loaded,
    busy,
    error,
    trusted,
    enabled,
    load,
    trust,
    setEnabled,
    refresh,
  };
}
