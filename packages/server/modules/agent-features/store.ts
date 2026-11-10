import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataDir } from "@projector-ai/core/modules/app-paths/index.ts";
import {
  agentFeatureCatalog,
  featureAgents,
  hasFeatureAgent,
  type AgentFeature,
} from "./catalog.ts";

/** Where the user's choices live: `$XDG_DATA_HOME/projector/agent/features.json`. */
export const featuresFile = () => join(dataDir(), "agent", "features.json");

interface Stored {
  /** Enabled agent ids per feature; a feature missing here uses its defaults. */
  features: Record<string, string[]>;
}

function stateOf(text: string): Stored {
  try {
    const data = JSON.parse(text) as { features?: unknown };
    const features: Record<string, string[]> = {};
    if (data?.features && typeof data.features === "object")
      for (const [id, value] of Object.entries(data.features))
        if (Array.isArray(value))
          features[id] = value.filter((agent): agent is string => typeof agent === "string");
    return { features };
  } catch {
    return { features: {} };
  }
}

async function readState(): Promise<Stored> {
  try {
    return stateOf(await readFile(featuresFile(), "utf8"));
  } catch {
    return { features: {} };
  }
}

/** Writes through a temporary file, so a failed save never leaves half a settings file. */
async function writeState(state: Stored): Promise<void> {
  const path = featuresFile();
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

/** The agents a feature is on for: the saved choice, or the feature's defaults before the first change. */
function enabledAgents(feature: AgentFeature, state: Stored): string[] {
  const saved = state.features[feature.id];
  const agents = saved ?? feature.defaults ?? [];
  return agents.filter((id) => hasFeatureAgent(id));
}

/** What the island shows: every feature with every agent it can be given to. */
export async function featureSettings() {
  const state = await readState();
  return {
    features: agentFeatureCatalog.list().map((feature) => ({
      id: feature.id,
      title: feature.title,
      summary: feature.summary,
      agents: featureAgents().map((agent) => ({
        id: agent.id,
        label: agent.label,
        enabled: enabledAgents(feature, state).includes(agent.id),
      })),
    })),
    file: featuresFile(),
  };
}

/** One write at a time: two toggles read the same file and must not lose each other's change. */
let queue: Promise<unknown> = Promise.resolve();

/** Turns one feature on or off for one agent; returns the state the island should show. */
export async function setFeatureAgent(
  featureId: string,
  agentId: string,
  enabled: boolean,
): Promise<Awaited<ReturnType<typeof featureSettings>>> {
  const feature = agentFeatureCatalog.get(featureId);
  if (!feature) throw new Error(`Неизвестная возможность: ${featureId}`);
  if (!hasFeatureAgent(agentId)) throw new Error(`Неизвестный агент: ${agentId}`);
  const task = queue.then(async () => {
    const state = await readState();
    const current = enabledAgents(feature, state);
    state.features[feature.id] = enabled
      ? [...new Set([...current, agentId])]
      : current.filter((id) => id !== agentId);
    await writeState(state);
    return featureSettings();
  });
  queue = task.catch(() => undefined);
  return task;
}

/** The ids of the features the agent has on: the chat's choice, or the user's defaults. */
export async function enabledFeatures(agentId: string, features?: string[]): Promise<string[]> {
  if (features)
    return agentFeatureCatalog
      .list()
      .filter((feature) => features.includes(feature.id))
      .map((feature) => feature.id);
  const state = await readState();
  return agentFeatureCatalog
    .list()
    .filter((feature) => enabledAgents(feature, state).includes(agentId))
    .map((feature) => feature.id);
}

export async function featureEnabled(
  agentId: string,
  featureId: string,
  features?: string[],
): Promise<boolean> {
  return (await enabledFeatures(agentId, features)).includes(featureId);
}

/**
 * The instructions of every feature the agent has on, or an empty string. `features` is the chat's
 * own choice (an empty list means none); without it the user's defaults for the agent apply.
 * Backends combine this text with their own prompt: Projector reads it into the system prompt,
 * others into the first message of a session.
 */
export async function enabledFeatureText(agentId: string, features?: string[]): Promise<string> {
  const ids = new Set(await enabledFeatures(agentId, features));
  return agentFeatureCatalog
    .list()
    .filter((feature) => ids.has(feature.id))
    .map((feature) => feature.instruction().trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Marks where the injected abilities end and the user's own message begins. */
export const FEATURE_PROMPT_END = "<!-- projector:features:end -->";

/** The feature text framed for an agent that has no Projector prompt of its own. */
export async function featurePrompt(
  agentId: string,
  features?: string[],
  extra = "",
): Promise<string> {
  const text = [extra.trim(), await enabledFeatureText(agentId, features)]
    .filter(Boolean)
    .join("\n\n");
  if (!text) return "";
  return `[Projector] В этом чате включены дополнительные возможности Projector. Пользуйся ими, когда это уместно; обычные вопросы не загромождай.\n\n${text}\n\n${FEATURE_PROMPT_END}`;
}

/**
 * Splits a native session's first message into the instructions Projector injected and what the
 * user actually wrote. Sessions from before the marker are matched against the same prefix when
 * the agent still has the same abilities.
 */
export function splitFeaturePrompt(
  text: string,
  legacy?: string,
): { text: string; injected?: string } {
  const marker = FEATURE_PROMPT_END;
  const index = text.indexOf(marker);
  let rest: string;
  let injected: string | undefined;
  if (index >= 0) {
    injected = text.slice(0, index).trim() || undefined;
    rest = text.slice(index + marker.length).trim();
  } else {
    const prefix = legacy?.trim();
    if (prefix && text.startsWith(prefix)) {
      injected = prefix;
      rest = text.slice(prefix.length).trim();
    } else {
      rest = text;
    }
  }
  // A resumed session also carries the replayed chat before the new message: the actual words
  // are after this heading, the transcript itself is already shown as the session's own turns.
  const heading = "Новое сообщение пользователя:\n";
  const message = rest.lastIndexOf(heading);
  if (message >= 0) rest = rest.slice(message + heading.length).trim();
  return { text: rest, ...(injected ? { injected } : {}) };
}

/**
 * The title of a session an agent named after its first prompt: Projector's injected abilities
 * are not the conversation, so the user's own words become the title. An old title whose prompt
 * no longer matches the current abilities still ends with the message: its last paragraph is the
 * best name available.
 */
export function sessionTitleWithoutInjected(title: string, legacy?: string): string {
  const split = splitFeaturePrompt(title, legacy);
  if (split.text !== title) return split.text || title;
  if (!title.startsWith("[Projector]")) return title;
  const at = title.lastIndexOf("\n\n");
  if (at < 0) return title;
  const tail = title.slice(at + 2).trim();
  return tail && tail !== title ? tail : title;
}
