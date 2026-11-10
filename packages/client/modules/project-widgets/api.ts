import type { ProjectWidgetState } from "@projector-ai/core/modules/widget-catalog/index.ts";
import {
  readProjectWidgets,
  refreshProjectWidgets,
  writeProjectWidgetTrust,
} from "../widget-runtime/index.ts";

export type { ProjectWidgetState };

export function loadProjectWidgets(projectId: string): Promise<ProjectWidgetState> {
  return readProjectWidgets(projectId);
}

/** Trusting a file also updates the client registry, so the next message renders its widgets. */
export async function trustProjectWidgets(
  projectId: string,
  trusted: boolean,
): Promise<ProjectWidgetState> {
  const state = await writeProjectWidgetTrust(projectId, trusted);
  await refreshProjectWidgets(projectId);
  return state;
}
