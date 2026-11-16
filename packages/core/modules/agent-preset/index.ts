/**
 * A ready-made first request for an agent chat. A preset is offered on the empty chat screen of
 * every agent: a click puts its prompt into the composer, or opens the form the agent wrote into
 * it. Global presets live in the user's data, project presets live in `.projector/presets.json`
 * and stay inert until the user trusts that exact file.
 */
export interface AgentPreset {
  /** Stable id; project presets may shadow a global preset with the same id. */
  id: string;
  /** Short label of the starter chip. */
  title: string;
  description?: string;
  /** The request sent to the agent. Empty only for a form that asks for everything it needs. */
  prompt: string;
  /** Vue markup of a form (`Form` or `IntelligentForm`): the user fills it before sending. */
  form?: string;
}

/** The user-editable part of a preset; the server gives a new preset its id. */
export interface AgentPresetDraft {
  title: string;
  description?: string;
  prompt: string;
  form?: string;
}

/** Where a preset comes from: the user's data or the trusted file of the current project. */
export type AgentPresetSource = "global" | "project";

export interface AgentPresetView extends AgentPreset {
  source: AgentPresetSource;
}

/** The user's own presets, stored in `$XDG_DATA_HOME/projector/agent/presets.json`. */
export interface AgentPresetSettings {
  presets: AgentPreset[];
  file: string;
}

/** Presets of `.projector/presets.json`; they are inert until the file is trusted. */
export interface AgentProjectPresetState {
  projectId: string;
  /** Real folder of the project, the key of the trust decision. */
  path: string;
  file: string;
  exists: boolean;
  trusted: boolean;
  hash?: string;
  presets: AgentPreset[];
  /** Why the file could not be read or is unsafe; presets stay empty. */
  problem?: string;
}

/** Everything the settings and the empty chat screen need in one response. */
export interface AgentPresetBundle extends AgentPresetSettings {
  project?: AgentProjectPresetState;
}

export const AGENT_PRESET_ID = /^[a-z][a-z0-9-]{1,39}$/;

export const AGENT_PRESET_LIMITS = {
  title: 80,
  description: 400,
  prompt: 8_000,
  form: 20_000,
} as const;

export const projectPresetsRelativeFile = ".projector/presets.json";

function limited(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Reads a preset from a settings file, a command argument or a request body. Missing or broken
 * fields are dropped; a preset without a title or without anything to send is not a preset.
 */
export function normalizeAgentPreset(value: unknown): AgentPresetDraft | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const title = limited(row.title, AGENT_PRESET_LIMITS.title);
  if (!title) return undefined;
  const prompt = limited(row.prompt, AGENT_PRESET_LIMITS.prompt);
  const form = limited(row.form, AGENT_PRESET_LIMITS.form);
  if (!prompt && !form) return undefined;
  const description = limited(row.description, AGENT_PRESET_LIMITS.description);
  return {
    title,
    ...(description ? { description } : {}),
    prompt,
    ...(form ? { form } : {}),
  };
}

export function isAgentPresetId(value: unknown): value is string {
  return typeof value === "string" && AGENT_PRESET_ID.test(value);
}

/** The chip label for a preset kind: a form opens, a text preset fills the composer. */
export function presetNeedsForm(preset: Pick<AgentPreset, "form">): boolean {
  return !!preset.form?.trim();
}
