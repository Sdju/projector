import type { Component } from "vue";
import {
  createWidgetCatalog,
  type WidgetDefinition,
} from "../../../core/modules/widget-catalog/index.ts";

/** A component the chat can render: its definition (what the agent is told) and its implementation. */
export interface WidgetEntry {
  definition: WidgetDefinition;
  component: Component;
}

/** The client's catalog. The same definitions feed the agent's prompt, so the two cannot drift. */
export const widgetCatalog = createWidgetCatalog();
const components: Record<string, Component> = {};

/** Registering a name again replaces it. The composition root calls this, never a widget itself. */
export function registerWidget(entry: WidgetEntry): void {
  widgetCatalog.register(entry.definition);
  components[entry.definition.name] = entry.component;
}

export const registeredWidgets = (): Record<string, Component> => components;
export const isWidgetName = (name: string): boolean => Object.hasOwn(components, name);
