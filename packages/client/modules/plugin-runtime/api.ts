import { pluginCommandPrefix } from "@ai-projector/core/modules/plugins/index.ts";
import { PLUGIN_API_VERSION, type PluginApi } from "@ai-projector/plugin-api";
import { deviceBase } from "../../common/utilities/device-url.ts";
import {
  assetUrlFactory,
  addCommand,
  addLanguage,
  addPanel,
  addTab,
  commandIdIsFree,
  compileLanguageRules,
} from "./store.ts";
import type { RuntimePluginInfo } from "./catalog.ts";
import type { Scope } from "./scope.ts";
export function createApi(plugin: RuntimePluginInfo, scope: Scope): PluginApi {
  const assetUrl = assetUrlFactory(plugin.id, plugin.hash!);
  const commandPrefix = pluginCommandPrefix(plugin.id);
  const languages = new Set(plugin.languages.map((item) => item.id));
  const panels = new Set(plugin.panels.map((item) => item.id));
  const tabs = new Set(plugin.tabs.map((item) => item.id));
  const registeredLanguages = new Set<string>();
  const registeredPanels = new Set<string>();
  const registeredTabs = new Set<string>();
  const registeredCommands = new Set<string>();

  const assertActive = () => {
    if (scope.disposed) throw new Error("Плагин уже выключен");
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
  } as PluginApi;
}
