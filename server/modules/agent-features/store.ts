import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataDir } from "../../../core/modules/app-paths/index.ts";
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

/**
 * The instructions of every feature the agent has on, or an empty string. Backends combine this
 * text with their own prompt: Projector reads it into the system prompt, others into the first
 * message of a session.
 */
export async function enabledFeatureText(agentId: string): Promise<string> {
  const state = await readState();
  return agentFeatureCatalog
    .list()
    .filter((feature) => enabledAgents(feature, state).includes(agentId))
    .map((feature) => feature.instruction().trim())
    .filter(Boolean)
    .join("\n\n");
}

/** The feature text framed for an agent that has no Projector prompt of its own. */
export async function featurePrompt(agentId: string): Promise<string> {
  const text = await enabledFeatureText(agentId);
  if (!text) return "";
  return `[Projector] В этом чате включены дополнительные возможности Projector. Пользуйся ими, когда это уместно; обычные вопросы не загромождай.\n\n${text}`;
}
