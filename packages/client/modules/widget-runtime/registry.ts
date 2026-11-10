import { ref, shallowReactive } from "vue";
import type { Component } from "vue";
import {
  createWidgetCatalog,
  type WidgetDefinition,
} from "@ai-projector/core/modules/widget-catalog/index.ts";

/** A component the chat can render: its definition (what the agent is told) and its implementation. */
export interface WidgetEntry {
  definition: WidgetDefinition;
  component: Component;
}

/** The client's built-in catalog. Project widgets live beside it, scoped by project id. */
export const widgetCatalog = createWidgetCatalog();
const components = shallowReactive<Record<string, Component>>({});
const projects = shallowReactive<Record<string, Record<string, WidgetEntry>>>({});

/** Bumped when a project's widgets arrive: a computed message re-splits and finds them. */
export const projectWidgetsVersion = ref(0);

/** Registering a name again replaces it. The composition root calls this, never a widget itself. */
export function registerWidget(entry: WidgetEntry): void {
  widgetCatalog.register(entry.definition);
  components[entry.definition.name] = entry.component;
}

/** Installs (or replaces) everything a project's trusted file declares. */
export function registerProjectWidgets(
  projectId: string,
  entries: Record<string, WidgetEntry>,
): void {
  if (!projectId) return;
  projects[projectId] = entries;
  projectWidgetsVersion.value++;
}

export function clearProjectWidgets(projectId: string): void {
  if (!projectId || !(projectId in projects)) return;
  delete projects[projectId];
  projectWidgetsVersion.value++;
}

export function projectWidgetEntries(projectId?: string): Record<string, WidgetEntry> {
  if (!projectId) return {};
  return projects[projectId] ?? {};
}

/** The definition the prompt and the renderer agree on; a project widget may not shadow a built-in. */
export function widgetDefinition(name: string, projectId?: string): WidgetDefinition | undefined {
  return projectWidgetEntries(projectId)[name]?.definition ?? widgetCatalog.get(name);
}

export function registeredWidgets(projectId?: string): Record<string, Component> {
  const own = projectWidgetEntries(projectId);
  if (!Object.keys(own).length) return components;
  const merged: Record<string, Component> = Object.assign({}, components);
  for (const [name, entry] of Object.entries(own)) merged[name] = entry.component;
  return merged;
}

export const isWidgetName = (name: string, projectId?: string): boolean =>
  Object.hasOwn(components, name) || Object.hasOwn(projectWidgetEntries(projectId), name);

/** Built-in and project widgets whose final block can replace the composer. */
export function answerWidgetNames(projectId?: string): string[] {
  const project = Object.values(projectWidgetEntries(projectId))
    .map((entry) => entry.definition)
    .filter((definition) => definition.answer)
    .map((definition) => definition.name);
  return [
    ...widgetCatalog
      .list()
      .filter((definition) => definition.answer)
      .map((definition) => definition.name),
    ...project,
  ];
}
