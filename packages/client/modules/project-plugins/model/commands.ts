import { commandArgs } from "../../../common/utilities/commands.ts";
import { refreshClientAgents } from "../../agents-integration/catalog/index.ts";
import { currentPluginProject, refreshPluginRuntime } from "../../plugin-runtime/index.ts";
import type { PluginInfo } from "../../plugins/index.ts";
import { fetchProjectPlugins, projectPluginAction } from "../api.ts";

function publicPlugins(plugins: PluginInfo[]) {
  return plugins.map(
    ({ server: _server, browser: _browser, path: _path, source: _source, ...plugin }) => plugin,
  );
}

/** The editor command registrar of the workspace; project plugins add no separate scope. */
export type ProjectPluginCommandRegistrar = (
  id: string,
  title: string,
  run: (args?: unknown) => unknown,
  enabled: (args?: unknown) => boolean,
  requires?: undefined,
  meta?: { description?: string; arguments?: Record<string, string> },
) => unknown;

function project(): string {
  const id = currentPluginProject();
  if (!id) throw new Error("Проект не открыт");
  return id;
}

function idOf(value: unknown): string {
  const id = commandArgs(value).id;
  if (typeof id !== "string" || !id.trim()) throw new Error("Укажите id плагина проекта");
  return id.trim();
}

/** Project plugin commands live in the workspace scope, next to files, Git and widgets. */
export function registerProjectPluginCommands(register: ProjectPluginCommandRegistrar): void {
  const afterChange = async () => {
    await Promise.all([
      refreshPluginRuntime().catch(() => undefined),
      refreshClientAgents().catch(() => undefined),
    ]);
  };

  register(
    "ide.project.plugins.list",
    "Плагины проекта",
    async () => {
      const plugins = await fetchProjectPlugins(project());
      return {
        directory: ".projector/plugins",
        plugins: publicPlugins(plugins),
      };
    },
    () => true,
    undefined,
    {
      description:
        "Возвращает плагины из .projector/plugins, их доверие, включённость, вклады и диагностику. Код и агенты не запускаются чтением каталога.",
    },
  );

  register(
    "ide.project.plugins.trust",
    "Доверять плагину проекта",
    async (value) => {
      const trusted = commandArgs(value).trusted;
      if (typeof trusted !== "boolean") throw new Error("trusted должен быть boolean");
      const plugins = await projectPluginAction(
        project(),
        trusted ? "trust" : "untrust",
        idOf(value),
      );
      await afterChange();
      return publicPlugins(plugins);
    },
    () => true,
    undefined,
    {
      description:
        "Подтверждает точное текущее содержимое плагина в .projector/plugins и включает его в проекте. Изменение файлов отзывает доверие.",
      arguments: {
        id: "string: имя пакета",
        trusted: "boolean: доверять ли текущему содержимому",
      },
    },
  );

  register(
    "ide.project.plugins.enable",
    "Включить плагин проекта",
    async (value) => {
      const plugins = await projectPluginAction(project(), "enable", idOf(value));
      await afterChange();
      return publicPlugins(plugins);
    },
    () => true,
    undefined,
    {
      description: "Включает уже доверенный плагин из .projector/plugins в текущем проекте.",
      arguments: { id: "string: имя пакета" },
    },
  );

  register(
    "ide.project.plugins.disable",
    "Выключить плагин проекта",
    async (value) => {
      const plugins = await projectPluginAction(project(), "disable", idOf(value));
      await afterChange();
      return publicPlugins(plugins);
    },
    () => true,
    undefined,
    {
      description: "Выключает плагин из .projector/plugins в текущем проекте, не удаляя папку.",
      arguments: { id: "string: имя пакета" },
    },
  );
}
