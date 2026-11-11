import { ref, type Component } from "vue";
import type { AgentUsageWindowDefinition } from "@ai-projector/core/modules/usage-analytics/index.ts";
import IconBot from "~icons/lucide/bot";
import IconCode from "~icons/lucide/code";
import IconSparkles from "~icons/lucide/sparkles";
import IconTerminal from "~icons/lucide/terminal";

/** One item of the agent's own task list, as the chat pins and shows it. */
export interface AgentPlanItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  /** What the agent says while the item is being done. */
  active?: string;
}

/** A tool call a plan reader may recognize. */
export interface AgentPlanCall {
  name: string;
  input?: string;
}

/**
 * Reads one tool call as a task list: `undefined` when the call does not carry one, `[]` when the
 * agent cleared the list. The schema belongs to the agent, so the shared chat only asks this reader.
 */
export type AgentPlanReader = (call: AgentPlanCall) => AgentPlanItem[] | undefined;

/**
 * What the client knows about an agent: the backend that answers in the chat, the terminal
 * program it stands for and how it is shown in menus and settings. Agents register themselves;
 * the shared code reads this catalog instead of naming them.
 */
export interface ClientAgent {
  /** Backend id of the agent (`claude-code`). */
  backend: string;
  /** Terminal program that starts the agent (`claude`). */
  program: string;
  title: string;
  caption: string;
  icon: Component;
  /** The built-in Projector agent: it has a chat but no terminal program. */
  builtin?: boolean;
  /** A local descriptor for a backend a plugin provides; it disappears when the server drops it. */
  plugin?: boolean;
  /** The limits indicator of the agent, if it has one. */
  usage?: Component;
  /** Where a fresh limits answer comes from; the analytics page records it by asking. */
  usageUrl?: string;
  /** Props of the generic indicator a plugin agent uses; built-ins have their own components. */
  usageProps?: Record<string, unknown>;
  /** How the agent keeps its task list, if it has one. */
  plan?: AgentPlanReader;
}

/** The agents a plugin added at runtime; a local descriptor with the same id always wins. */
const remote = new Set<string>();
/** Local descriptors of plugin agents, kept even while the backend is absent. */
const localPlugins = new Map<string, ClientAgent>();
/** Bumped on every catalog change, so menus and settings computed from it stay live. */
const revision = ref(0);
const agents = new Map<string, ClientAgent>();

const fallbackIcon = IconTerminal;
const icons: Record<string, Component> = {
  bot: IconBot,
  code: IconCode,
  sparkles: IconSparkles,
  terminal: IconTerminal,
};

function iconOf(name: unknown): Component {
  return typeof name === "string" && icons[name] ? icons[name] : fallbackIcon;
}

/** Registers an agent; registering the same backend again replaces it and keeps the order. */
export function registerClientAgent(agent: ClientAgent): void {
  if (agent.plugin) localPlugins.set(agent.backend, agent);
  agents.set(agent.backend, agent);
  revision.value++;
}

/** Every registered agent, in registration order. */
export function clientAgents(): ClientAgent[] {
  void revision.value;
  return [...agents.values()];
}

/** The external agent behind a terminal program; the built-in agent has none. */
export function clientAgentOf(program: string): ClientAgent | undefined {
  void revision.value;
  return clientAgents().find((agent) => !agent.builtin && agent.program === program);
}

/** The agent behind a chat backend, built-in included. */
export function clientAgentByBackend(backend: string): ClientAgent | undefined {
  void revision.value;
  return agents.get(backend);
}

/** Terminal programs of the external agents, in registration order. */
export function clientAgentPrograms(): string[] {
  return clientAgents()
    .filter((agent) => !agent.builtin)
    .map((agent) => agent.program);
}

interface RemoteAgent {
  id?: unknown;
  label?: unknown;
  caption?: unknown;
  icon?: unknown;
  program?: unknown;
  usageUrl?: unknown;
  usageWindows?: unknown;
}

function usageWindowsOf(value: unknown): AgentUsageWindowDefinition[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const windows: AgentUsageWindowDefinition[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const window = item as Record<string, unknown>;
    if (
      typeof window.name !== "string" ||
      !window.name ||
      typeof window.label !== "string" ||
      !window.label ||
      typeof window.shortLabel !== "string" ||
      !window.shortLabel ||
      typeof window.periodSeconds !== "number" ||
      !Number.isFinite(window.periodSeconds)
    )
      continue;
    const ticks = Array.isArray(window.ticks)
      ? window.ticks.filter(
          (tick): tick is number => typeof tick === "number" && Number.isFinite(tick),
        )
      : [];
    windows.push({
      name: window.name,
      label: window.label,
      shortLabel: window.shortLabel,
      periodSeconds: window.periodSeconds,
      ...(ticks.length ? { ticks } : {}),
    });
  }
  return windows.length ? windows : undefined;
}

function usagePropsOf(
  item: RemoteAgent,
  title: string,
  icon: Component,
): Record<string, unknown> | undefined {
  if (typeof item.usageUrl !== "string" || !item.usageUrl) return undefined;
  const windows = usageWindowsOf(item.usageWindows);
  return {
    usageUrl: item.usageUrl,
    title,
    agentId: item.id,
    icon,
    ...(windows ? { windows } : {}),
  };
}

/** Adds the server's generic limits to a local descriptor without replacing its own indicator. */
function withRemoteUsage(
  agent: ClientAgent,
  item: RemoteAgent,
  title: string,
  icon: Component,
): ClientAgent {
  if (agent.usage) return agent;
  const usageProps = usagePropsOf(item, title, icon);
  if (!usageProps) {
    if (!agent.usageUrl && !agent.usageProps) return agent;
    const next = { ...agent };
    delete next.usageUrl;
    delete next.usageProps;
    return next;
  }
  return { ...agent, usageUrl: usageProps.usageUrl as string, usageProps };
}

/**
 * Merges the server's agent catalog into the client one. Local descriptors win: the built-in
 * agents keep their icons, plans and limits; only agents the client has never seen get a
 * fallback presentation. A removed plugin agent disappears from every menu on the next refresh.
 */
export async function refreshClientAgents(): Promise<void> {
  if (typeof fetch !== "function") return;
  let backends: RemoteAgent[];
  try {
    const response = await fetch("/api/agent/backends", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return;
    const body = (await response.json()) as { backends?: unknown };
    if (!Array.isArray(body.backends)) return;
    backends = body.backends as RemoteAgent[];
  } catch {
    return;
  }
  const seen = new Set<string>();
  for (const item of backends) {
    if (!item || typeof item.id !== "string" || !item.id) continue;
    const label = typeof item.label === "string" && item.label ? item.label : item.id;
    const existing = agents.get(item.id);
    const local = localPlugins.get(item.id);
    if (local) {
      // The backend was absent on an earlier refresh; restore the rich local descriptor instead
      // of a fallback icon/caption when the plugin is enabled later.
      const next = withRemoteUsage(local, item, local.title, local.icon);
      if (agents.get(item.id) !== next) {
        agents.set(item.id, next);
        revision.value++;
      }
      seen.add(item.id);
      continue;
    }
    if (existing && !remote.has(item.id)) {
      // Local descriptors keep their icon and plan; the server only fills in missing limits.
      const next = withRemoteUsage(existing, item, existing.title, existing.icon);
      if (next !== existing) {
        agents.set(item.id, next);
        revision.value++;
      }
      seen.add(item.id);
      continue;
    }
    seen.add(item.id);
    const icon = iconOf(item.icon);
    const usageProps = usagePropsOf(item, label, icon);
    registerClientAgent({
      backend: item.id,
      program: typeof item.program === "string" && item.program ? item.program : item.id,
      title: label,
      caption:
        typeof item.caption === "string" && item.caption
          ? item.caption
          : `Запустит агента ${label}`,
      icon,
      ...(usageProps ? { usageUrl: usageProps.usageUrl as string, usageProps } : {}),
    });
  }
  let removed = false;
  for (const id of remote) {
    if (seen.has(id)) continue;
    if (!agents.get(id)?.builtin) {
      agents.delete(id);
      removed = true;
    }
  }
  // A local descriptor may keep a plugin agent's icon, plan and limits while the server provides
  // the backend. When the plugin disappears, the descriptor goes with it.
  for (const [id, agent] of agents)
    if (agent.plugin && !seen.has(id)) {
      agents.delete(id);
      removed = true;
    }
  if (removed) revision.value++;
  remote.clear();
  for (const id of seen) remote.add(id);
}
