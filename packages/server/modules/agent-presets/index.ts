import type { AgentPresetBundle } from "@ai-projector/core/modules/agent-preset/index.ts";
import { presetSettings } from "./store.ts";
import { projectPresetState } from "./project.ts";

export { createPreset, deletePreset, presetSettings, presetsFile, savePreset } from "./store.ts";
export {
  createProjectPreset,
  deleteProjectPreset,
  projectPresetState,
  projectPresetsRelativeFile,
  projectPresetsTrustFile,
  saveProjectPreset,
  setProjectPresetTrust,
  trustedProjectPresets,
} from "./project.ts";

/** The user's presets plus, when a project is named, its file and trust decision. */
export async function presetBundle(projectId?: string): Promise<AgentPresetBundle> {
  const [global, project] = await Promise.all([
    presetSettings(),
    projectId ? projectPresetState(projectId) : Promise.resolve(undefined),
  ]);
  return { ...global, ...(project ? { project } : {}) };
}
