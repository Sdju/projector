import {
  isPluginHttpPath,
  pluginCommandPrefix,
  pluginPackageKey,
  pluginStorageFits,
  pluginStorageKey,
  pluginStorageMaxBytes,
  serializePluginStorageValue,
} from "@ai-projector/core/modules/plugins/index.ts";
import { PLUGIN_API_VERSION, type PluginApi } from "@ai-projector/plugin-api";
import { deviceBase, deviceUrl } from "../../common/utilities/device-url.ts";
import {
  assetUrlFactory,
  addAgent,
  addCommand,
  addLanguage,
  addPanel,
  addTab,
  commandIdIsFree,
  compileLanguageRules,
} from "./store.ts";
import type { RuntimePluginInfo } from "./catalog.ts";
import type { Scope } from "./scope.ts";

/** Package-scoped state on the device that owns the package; the key never becomes a path. */
function storageUrl(plugin: RuntimePluginInfo): string {
  return deviceUrl(`/api/plugins/${pluginPackageKey(plugin.id)}/storage`);
}

async function storageError(response: Response): Promise<Error> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) return new Error(body.error);
  } catch {
    // A non-JSON body is still a failed request; the status below is the fallback message.
  }
  return new Error(`Хранилище плагина недоступно (${response.status})`);
}

export function createApi(plugin: RuntimePluginInfo, scope: Scope): PluginApi {
  const assetUrl = assetUrlFactory(plugin.id, plugin.hash!);
  const commandPrefix = pluginCommandPrefix(plugin.id);
  const storagePath = storageUrl(plugin);
  const languages = new Set(plugin.languages.map((item) => item.id));
  const panels = new Set(plugin.panels.map((item) => item.id));
  const tabs = new Set(plugin.tabs.map((item) => item.id));
  const agents = new Set((plugin.agents ?? []).map((item) => item.id));
  const registeredLanguages = new Set<string>();
  const registeredPanels = new Set<string>();
  const registeredTabs = new Set<string>();
  const registeredCommands = new Set<string>();
  const registeredAgents = new Set<string>();

  const assertActive = () => {
    if (scope.disposed) throw new Error("Плагин уже выключен");
  };
  const storageRequest = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const response = await fetch(url, { signal: scope.signal, cache: "no-store", ...init });
    if (!response.ok) throw await storageError(response);
    return response;
  };
  const readStorage = async (): Promise<Record<string, unknown>> => {
    const response = await storageRequest(storagePath, { headers: { Accept: "application/json" } });
    const body = (await response.json()) as { data?: unknown };
    const data = body?.data;
    return data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  };
  const assertStorageValue = (value: unknown): void => {
    const text = serializePluginStorageValue(value);
    if (!pluginStorageFits(text))
      throw new Error(
        `Значение не помещается в хранилище плагина (лимит ${pluginStorageMaxBytes} байт)`,
      );
  };
  const declared = <T extends { id: string }>(list: T[], id: string, label: string): T => {
    const item = list.find((entry) => entry.id === id);
    if (!item) throw new Error(`${label} ${id} не объявлен в манифесте`);
    return item;
  };

  return {
    apiVersion: PLUGIN_API_VERSION,
    packageName: plugin.id,
    packageVersion: plugin.version ?? "0.0.0",
    device: deviceBase().split("/")[2] ?? "",
    signal: scope.signal,
    assetUrl,
    onDispose(dispose) {
      if (typeof dispose !== "function") throw new Error("onDispose ожидает функцию");
      scope.add(dispose);
    },
    languages: {
      register(contribution) {
        assertActive();
        if (!languages.has(contribution.id))
          throw new Error(`Язык ${contribution.id} не объявлен в манифесте`);
        if (registeredLanguages.has(contribution.id))
          throw new Error(`Язык ${contribution.id} уже зарегистрирован`);
        const declaration = declared(plugin.languages, contribution.id, "Язык");
        const rules = compileLanguageRules(contribution.rules, contribution.caseInsensitive);
        registeredLanguages.add(contribution.id);
        const remove = addLanguage(plugin.id, declaration, rules, assetUrl);
        scope.add(remove);
        return { dispose: remove };
      },
    },
    panels: {
      register(contribution) {
        assertActive();
        if (!panels.has(contribution.id))
          throw new Error(`Панель ${contribution.id} не объявлена в манифесте`);
        if (registeredPanels.has(contribution.id))
          throw new Error(`Панель ${contribution.id} уже зарегистрирована`);
        if (typeof contribution.mount !== "function")
          throw new Error(`Панель ${contribution.id}: нужен mount`);
        const declaration = declared(plugin.panels, contribution.id, "Панель");
        registeredPanels.add(contribution.id);
        const remove = addPanel(plugin.id, declaration, contribution.mount as never, assetUrl);
        scope.add(remove);
        return { dispose: remove };
      },
    },
    tabs: {
      register(contribution) {
        assertActive();
        if (!tabs.has(contribution.id))
          throw new Error(`Вкладка ${contribution.id} не объявлена в манифесте`);
        if (registeredTabs.has(contribution.id))
          throw new Error(`Вкладка ${contribution.id} уже зарегистрирована`);
        if (typeof contribution.mount !== "function")
          throw new Error(`Вкладка ${contribution.id}: нужен mount`);
        const declaration = declared(plugin.tabs, contribution.id, "Вкладка");
        registeredTabs.add(contribution.id);
        const remove = addTab(plugin.id, declaration, contribution.mount as never, assetUrl);
        scope.add(remove);
        return { dispose: remove };
      },
    },
    commands: {
      prefix: commandPrefix,
      register(contribution) {
        assertActive();
        if (
          typeof contribution.id !== "string" ||
          !contribution.id.startsWith(commandPrefix) ||
          !/^[a-z0-9][a-z0-9._-]*$/.test(contribution.id.slice(commandPrefix.length))
        )
          throw new Error(`Команда плагина должна находиться в пространстве ${commandPrefix}`);
        if (typeof contribution.run !== "function") throw new Error("Команде плагина нужен run");
        if (typeof contribution.title !== "string" || !contribution.title.trim())
          throw new Error(`Команда ${contribution.id}: нужен title`);
        if (typeof contribution.description !== "string" || !contribution.description.trim())
          throw new Error(`Команда ${contribution.id}: нужно описание`);
        if (registeredCommands.has(contribution.id) || !commandIdIsFree(contribution.id))
          throw new Error(`Команда ${contribution.id} уже зарегистрирована`);
        registeredCommands.add(contribution.id);
        const remove = addCommand(plugin.id, {
          id: contribution.id,
          title: contribution.title,
          description: contribution.description,
          arguments: contribution.arguments,
          run: contribution.run,
        });
        scope.add(remove);
        return { dispose: remove };
      },
    },
    agents: {
      register(contribution) {
        assertActive();
        if (!agents.has(contribution.id))
          throw new Error(`Агент ${contribution.id} не объявлен в манифесте`);
        if (registeredAgents.has(contribution.id))
          throw new Error(`Агент ${contribution.id} уже зарегистрирован`);
        if (contribution.plan !== undefined && typeof contribution.plan !== "function")
          throw new Error(`Агент ${contribution.id}: plan должен быть функцией`);
        if (contribution.mountUsage !== undefined && typeof contribution.mountUsage !== "function")
          throw new Error(`Агент ${contribution.id}: mountUsage должен быть функцией`);
        if (contribution.toolLabel !== undefined && typeof contribution.toolLabel !== "function")
          throw new Error(`Агент ${contribution.id}: toolLabel должен быть функцией`);
        registeredAgents.add(contribution.id);
        const remove = addAgent(plugin.id, contribution, assetUrl);
        scope.add(remove);
        return { dispose: remove };
      },
    },
    httpUrl(path) {
      assertActive();
      if (!isPluginHttpPath(path)) throw new Error("Некорректный путь маршрута плагина");
      return deviceUrl(`/api/plugins/${pluginPackageKey(plugin.id)}/${path}`);
    },
    storage: {
      async get(key) {
        assertActive();
        const item = pluginStorageKey(key);
        const data = await readStorage();
        return Object.hasOwn(data, item) ? data[item] : undefined;
      },
      async set(key, value) {
        assertActive();
        const item = pluginStorageKey(key);
        assertStorageValue(value);
        await storageRequest(storagePath, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: item, value }),
        });
      },
      async delete(key) {
        assertActive();
        const item = pluginStorageKey(key);
        await storageRequest(`${storagePath}?key=${encodeURIComponent(item)}`, {
          method: "DELETE",
        });
      },
      async keys() {
        assertActive();
        return Object.keys(await readStorage());
      },
    },
  } as PluginApi;
}
