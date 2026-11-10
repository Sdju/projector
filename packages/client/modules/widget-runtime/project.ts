import type { ProjectWidgetState } from "@projector-ai/core/modules/widget-catalog/index.ts";
import { readProjectWidgets } from "./project-api.ts";
import { clearProjectWidgets, registerProjectWidgets, type WidgetEntry } from "./registry.ts";
import { createProjectWidget } from "./project-widget.ts";

const loads = new Map<string, Promise<ProjectWidgetState | undefined>>();

/** Loads and registers the trusted widgets of a project; repeated calls share one request. */
export function ensureProjectWidgets(
  projectId: string | undefined,
  force = false,
): Promise<ProjectWidgetState | undefined> {
  if (!projectId) return Promise.resolve(undefined);
  if (!force) {
    const known = loads.get(projectId);
    if (known) return known;
  }
  const loading = readProjectWidgets(projectId)
    .then((state) => {
      if (!state.trusted || !state.widgets.length) {
        clearProjectWidgets(projectId);
        return state;
      }
      const entries: Record<string, WidgetEntry> = {};
      for (const definition of state.widgets)
        entries[definition.name] = {
          definition,
          component: createProjectWidget(definition, projectId),
        };
      registerProjectWidgets(projectId, entries);
      return state;
    })
    .catch(() => {
      clearProjectWidgets(projectId);
      return undefined;
    });
  loads.set(projectId, loading);
  loading.catch(() => loads.delete(projectId));
  return loading;
}

/** A settings save changes the trust decision: the next chat turn must see the new set. */
export function refreshProjectWidgets(projectId: string): Promise<ProjectWidgetState | undefined> {
  loads.delete(projectId);
  return ensureProjectWidgets(projectId, true);
}
