import { computed, onBeforeUnmount, watchEffect } from "vue";
import { defineTab, type SidebarType, type TabRegistry } from "../../workspace-api/index.ts";
import type { SidebarHost, SidebarViews } from "./sidebar-views.ts";
import { registerProjectPluginCommands } from "../../project-plugins/index.ts";
import {
  PluginContributionMount,
  pluginPanelCommandId,
  pluginPanelKind,
  pluginTabCommandId,
  pluginTabKind,
  reportIssue,
  runtimeCommands,
  runtimePanels,
  runtimeTabs,
} from "../../plugin-runtime/index.ts";

function sectionOf(item: (typeof runtimePanels.value)[number]): SidebarType {
  return {
    id: pluginPanelKind(item.packageName, item.declaration.id),
    title: item.declaration.title,
    kind: pluginPanelKind(item.packageName, item.declaration.id),
    command: pluginPanelCommandId(item.packageName, item.declaration.id),
    // The manifest placement `aside` is the service group of the rail (it used to be a right rail).
    utility: item.declaration.placement === "aside",
  };
}

/** Plugin panels become ordinary sidebar sections; their views mount borrowed DOM. */
export function usePluginWorkspaceViews(baseSidebarViews: SidebarViews | undefined) {
  const pluginSidebarSections = computed<SidebarType[]>(() =>
    runtimePanels.value
      .filter(
        (item) =>
          item.declaration.placement === "sidebar" || item.declaration.placement === "aside",
      )
      .map(sectionOf),
  );
  const pluginPanelViews = computed<SidebarViews>(() =>
    Object.fromEntries(
      runtimePanels.value.map((item) => {
        const kind = pluginPanelKind(item.packageName, item.declaration.id);
        return [
          kind,
          {
            icon: "puzzle",
            component: PluginContributionMount,
            props: (host: SidebarHost) => ({
              kind: "panel",
              instance: item.instance,
              plugin: item.packageName,
              contributionId: item.declaration.id,
              projectId: host.projectId,
              onCommand: (id: string, args?: unknown) =>
                host.executeCommand?.(id, args) ??
                Promise.resolve().then(() => host.command(id, args)),
              onOpenFile: (path: string, options?: { line?: number; column?: number }) =>
                host.openFile(path, options?.line, options?.column),
              onOpenTab: (id: string, params?: Record<string, unknown>) => host.openTab(id, params),
            }),
          },
        ];
      }),
    ),
  );
  const mergedSidebarViews = computed<SidebarViews>(() => ({
    ...baseSidebarViews,
    ...pluginPanelViews.value,
  }));
  return { pluginSidebarSections, mergedSidebarViews };
}

export interface PluginWorkspaceCommands {
  tabTypes: TabRegistry;
  registerEditor: (
    id: string,
    title: string,
    run: (args?: unknown) => unknown,
    enabled: (args?: unknown) => boolean,
    requires?: undefined,
    meta?: { description?: string; arguments?: Record<string, string> },
  ) => unknown;
  openTab(id: string, params?: Record<string, unknown>): void;
  showSection(id: string): void;
}

/** Adds plugin tab kinds, their open commands and plugin IDE commands for this workspace. */
export function registerPluginWorkspaceCommands(host: PluginWorkspaceCommands): void {
  registerProjectPluginCommands(host.registerEditor);
  const tabDisposers = new Map<string, () => void>();
  const commandDisposers = new Map<string, () => void>();
  const tabType = (contribution: (typeof runtimeTabs.value)[number]) => {
    const id = pluginTabKind(contribution.packageName, contribution.declaration.id);
    const title = contribution.declaration.title;
    return defineTab({
      id,
      key: (params) => {
        const keys = Object.keys(params).sort();
        return keys.length ? `${id}:${JSON.stringify(params, keys)}` : id;
      },
      path: () => title,
      title: (_params, content) => (content ? `${title} · ${content}` : title),
      hint: () => contribution.declaration.description ?? "",
      create: () => ({}),
      command: {
        id: pluginTabCommandId(contribution.packageName, contribution.declaration.id),
        title: `Открыть «${title}»`,
        description:
          contribution.declaration.description ||
          `Открывает вкладку плагина ${contribution.packageName}.`,
      },
    });
  };
  watchEffect(
    () => {
      const tabs = runtimeTabs.value;
      const wantedTabs = new Set<string>();
      for (const contribution of tabs) {
        const id = pluginTabKind(contribution.packageName, contribution.declaration.id);
        wantedTabs.add(id);
        if (!host.tabTypes.has(id)) {
          try {
            tabDisposers.set(id, host.tabTypes.register(tabType(contribution)));
          } catch (error) {
            reportIssue({
              plugin: contribution.packageName,
              phase: "contribution",
              message:
                error instanceof Error ? error.message : "Не удалось зарегистрировать вкладку",
            });
          }
        }
        const commandId = pluginTabCommandId(contribution.packageName, contribution.declaration.id);
        if (!commandDisposers.has(commandId)) {
          try {
            commandDisposers.set(
              commandId,
              host.registerEditor(
                commandId,
                `Открыть «${contribution.declaration.title}»`,
                () => host.openTab(id, {}),
                () => true,
                undefined,
                {
                  description:
                    contribution.declaration.description ||
                    `Открывает вкладку плагина ${contribution.packageName}.`,
                },
              ) as () => void,
            );
          } catch (error) {
            reportIssue({
              plugin: contribution.packageName,
              phase: "contribution",
              message:
                error instanceof Error ? error.message : "Не удалось зарегистрировать команду",
            });
          }
        }
      }
      for (const [id, dispose] of tabDisposers)
        if (!wantedTabs.has(id)) {
          dispose();
          tabDisposers.delete(id);
        }

      const wantedPanels = new Set<string>();
      for (const contribution of runtimePanels.value) {
        const commandId = pluginPanelCommandId(
          contribution.packageName,
          contribution.declaration.id,
        );
        wantedPanels.add(commandId);
        if (commandDisposers.has(commandId)) continue;
        try {
          const dispose = host.registerEditor(
            commandId,
            `Открыть панель «${contribution.declaration.title}»`,
            () => {
              const id = pluginPanelKind(contribution.packageName, contribution.declaration.id);
              host.showSection(id);
            },
            () => true,
            undefined,
            {
              description:
                contribution.declaration.description ||
                `Открывает панель плагина ${contribution.packageName}.`,
            },
          );
          commandDisposers.set(commandId, dispose as () => void);
        } catch (error) {
          reportIssue({
            plugin: contribution.packageName,
            phase: "contribution",
            message:
              error instanceof Error ? error.message : "Не удалось зарегистрировать команду панели",
          });
        }
      }
      const wantedCommands = new Map(runtimeCommands.value.map((item) => [item.id, item]));
      for (const [id, contribution] of wantedCommands) {
        if (commandDisposers.has(id)) continue;
        try {
          commandDisposers.set(
            id,
            host.registerEditor(id, contribution.title, contribution.run, () => true, undefined, {
              description: contribution.description,
              arguments: contribution.arguments,
            }) as () => void,
          );
        } catch (error) {
          reportIssue({
            plugin: contribution.packageName,
            phase: "contribution",
            message: error instanceof Error ? error.message : "Не удалось зарегистрировать команду",
          });
        }
      }
      for (const [id, dispose] of commandDisposers)
        if (
          !wantedPanels.has(id) &&
          !wantedCommands.has(id) &&
          !runtimeTabs.value.some(
            (tab) => pluginTabCommandId(tab.packageName, tab.declaration.id) === id,
          )
        ) {
          dispose();
          commandDisposers.delete(id);
        }
    },
    { flush: "sync" },
  );
  onBeforeUnmount(() => {
    for (const dispose of tabDisposers.values()) dispose();
    tabDisposers.clear();
    for (const dispose of commandDisposers.values()) dispose();
    commandDisposers.clear();
  });
}
