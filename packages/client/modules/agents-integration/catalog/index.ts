import { ref, type Component } from "vue";
import type { AgentUsageWindowDefinition } from "@ai-projector/core/modules/usage-analytics/index.ts";
import { hasIcon, registerIcon, type IconName } from "../../../common/icons/registry.ts";
import {
  currentPluginProject,
  findRuntimeAgent,
  runtimeAgents,
} from "../../plugin-runtime/index.ts";
import { PluginCustomUsageIndicator } from "../usage/index.ts";
import { iconFromSvg, iconNodesFromSvg } from "./icon.ts";
import { readTodosPlan, type AgentPlanReader } from "./plan.ts";

export { iconFromSvg, iconNodesFromSvg };
export type { AgentPlanCall, AgentPlanItem, AgentPlanReader } from "./plan.ts";
export { readTodosPlan } from "./plan.ts";

/**
 * What the client knows about an agent: the backend that answers in the chat, the terminal
 * program it stands for and how it is shown in menus and settings. Agents register themselves;
 * the shared code reads this catalog instead of naming them.
 */
export interface ClientAgent {
  /** Backend id of the agent (`claude-code`); a project agent carries the project scope. */
  backend: string;
  /** The project a project-plugin agent belongs to. */
  projectId?: string;
  /** Terminal program that starts the agent (`claude`). */
  program: string;
  title: string;
  caption: string;
  /** Shared icon name; the menus and settings render it without importing a component. */
  icon: IconName;
  /** The built-in Projector agent: it has a chat but no terminal program. */
  builtin?: boolean;
  /** The server starts this agent over ACP, so its command can be overridden on this machine. */
  launch?: boolean;
  /** A local descriptor for a backend a plugin provides; it disappears when the server drops it. */
  plugin?: boolean;
  /** The limits indicator of the agent, if it has one. */
  usage?: Component;
  /** Where a fresh limits answer comes from; the analytics page records it by asking. */
  usageUrl?: string;
  /** Props of the generic indicator a plugin agent uses; built-ins have their own components. */
  usageProps?: Record<string, unknown>;
  /** Extra agent-specific section rendered on the agent's settings page, if any. */
  settings?: Component;
  /** Section heading for `settings` on the agent's settings page. */
  settingsTitle?: string;
  /** How the agent keeps its task list, if it has one. */
  plan?: AgentPlanReader;
  /** Plugin-provided label for a tool call the shared chat does not name itself. */
  toolLabel?: (call: { name: string; input?: string; kind?: string }) => string | undefined;
}

/** The agents a plugin added at runtime; a local descriptor with the same id always wins. */
const remote = new Set<string>();
/** Fallback descriptors created from the server catalog, not the rich built-in/plugin ones. */
const remoteOwned = new Set<string>();
/** Local descriptors of plugin agents, kept even while the backend is absent. */
const localPlugins = new Map<string, ClientAgent>();
/** Bumped on every catalog change, so menus and settings computed from it stay live. */
const revision = ref(0);
const agents = new Map<string, ClientAgent>();

const fallbackIcon: IconName = "terminal";

/** A manifest names one of the shared icons; an unknown name gets the terminal. */
function iconOf(name: unknown): IconName {
  return typeof name === "string" && hasIcon(name) ? name : fallbackIcon;
}

/** A plugin SVG becomes a registered icon, so the catalog can keep passing names around. */
function iconFromRemote(item: RemoteAgent, backend: string): IconName {
  if (typeof item.iconSvg === "string" && item.iconSvg.includes("<svg")) {
    const name = `agent:${backend}`;
    registerIcon(name, iconFromSvg(item.iconSvg));
    return name;
  }
  return iconOf(item.icon);
}

/** Overlays live browser-plugin contributions without replacing a local usage indicator. */
function withRuntimeAgent(agent: ClientAgent): ClientAgent {
  void runtimeAgents.value;
  const runtime = findRuntimeAgent(agent.backend);
  if (!runtime) return agent;
  return {
    ...agent,
    ...(runtime.plan ? { plan: runtime.plan } : {}),
    ...(runtime.toolLabel ? { toolLabel: runtime.toolLabel } : {}),
    ...(runtime.mountUsage && !agent.usage
      ? {
          usage: PluginCustomUsageIndicator,
          usageProps: {
            agentId: agent.backend,
            title: agent.title,
            usageUrl: agent.usageUrl,
            packageName: runtime.packageName,
            instance: runtime.instance,
          },
        }
      : {}),
  };
}

function planFromRemote(item: RemoteAgent): AgentPlanReader | undefined {
  const tools =
    item.plan && typeof item.plan === "object"
      ? (item.plan as { tools?: unknown }).tools
      : undefined;
  if (!Array.isArray(tools) || !tools.every((tool) => typeof tool === "string" && tool))
    return undefined;
  return readTodosPlan(tools);
}

/** Registers an agent; registering the same backend again replaces it and keeps the order. */
export function registerClientAgent(agent: ClientAgent, options: { remote?: boolean } = {}): void {
  if (options.remote) remoteOwned.add(agent.backend);
  else remoteOwned.delete(agent.backend);
  if (agent.plugin) localPlugins.set(agent.backend, agent);
  agents.set(agent.backend, agent);
  revision.value++;
}

/** Every registered agent, in registration order. */
export function clientAgents(): ClientAgent[] {
  void revision.value;
  return [...agents.values()].map(withRuntimeAgent);
}

/** The external agent behind a terminal program; the built-in agent has none. */
export function clientAgentOf(program: string): ClientAgent | undefined {
  void revision.value;
  return clientAgents().find((agent) => !agent.builtin && agent.program === program);
}

/** The agent behind a chat backend, built-in included. */
export function clientAgentByBackend(backend: string): ClientAgent | undefined {
  void revision.value;
  const agent = agents.get(backend);
  return agent ? withRuntimeAgent(agent) : undefined;
}

/** Terminal programs of the external agents, in registration order. */
export function clientAgentPrograms(): string[] {
  return clientAgents()
    .filter((agent) => !agent.builtin)
    .map((agent) => agent.program);
}

interface RemoteAgent {
  id?: unknown;
  projectId?: unknown;
  label?: unknown;
  caption?: unknown;
  icon?: unknown;
  iconSvg?: unknown;
  plan?: unknown;
  program?: unknown;
  launch?: unknown;
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
  icon: IconName,
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
  icon: IconName,
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

/** The server is the only one that knows whether an agent starts over ACP. */
function withRemoteLaunch(agent: ClientAgent, item: RemoteAgent): ClientAgent {
  const launch = item.launch === true;
  if (!!agent.launch === launch) return agent;
  const next = { ...agent };
  if (launch) next.launch = true;
  else delete next.launch;
  return next;
}

/**
 * Merges the server's agent catalog into the client one. Local descriptors win: the built-in
 * agents keep their icons, plans and limits; only agents the client has never seen get a
 * fallback presentation. A removed plugin agent disappears from every menu on the next refresh.
 */
let agentCatalogRequest = 0;

export async function refreshClientAgents(
  projectId: string = currentPluginProject(),
): Promise<void> {
  if (typeof fetch !== "function") return;
  const request = ++agentCatalogRequest;
  let backends: RemoteAgent[];
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  try {
    const response = await fetch(`/api/agent/backends${query}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok || request !== agentCatalogRequest) return;
    const body = (await response.json()) as { backends?: unknown };
    if (!Array.isArray(body.backends) || request !== agentCatalogRequest) return;
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
      const next = withRemoteLaunch(withRemoteUsage(local, item, local.title, local.icon), item);
      if (agents.get(item.id) !== next) {
        agents.set(item.id, next);
        revision.value++;
      }
      seen.add(item.id);
      continue;
    }
    if (existing && !remoteOwned.has(item.id)) {
      // Built-in and local-plugin descriptors keep their components and icons on every refresh;
      // only their limits are filled from the server.
      const next = withRemoteLaunch(
        withRemoteUsage(existing, item, existing.title, existing.icon),
        item,
      );
      if (next !== existing) {
        agents.set(item.id, next);
        revision.value++;
      }
      seen.add(item.id);
      continue;
    }
    seen.add(item.id);
    const icon = iconFromRemote(item, item.id);
    const plan = planFromRemote(item);
    const usageProps = usagePropsOf(item, label, icon);
    registerClientAgent(
      {
        backend: item.id,
        ...(typeof item.projectId === "string" ? { projectId: item.projectId } : {}),
        program: typeof item.program === "string" && item.program ? item.program : item.id,
        title: label,
        caption:
          typeof item.caption === "string" && item.caption
            ? item.caption
            : `Запустит агента ${label}`,
        icon,
        ...(plan ? { plan } : {}),
        ...(item.launch === true ? { launch: true } : {}),
        ...(usageProps ? { usageUrl: usageProps.usageUrl as string, usageProps } : {}),
      },
      { remote: true },
    );
  }
  let removed = false;
  for (const id of remote) {
    if (seen.has(id)) continue;
    if (!agents.get(id)?.builtin) {
      agents.delete(id);
      remoteOwned.delete(id);
      removed = true;
    }
  }
  // A local descriptor may keep a plugin agent's icon, plan and limits while the server provides
  // the backend. When the plugin disappears, the descriptor goes with it.
  for (const [id, agent] of agents)
    if (agent.plugin && !seen.has(id)) {
      agents.delete(id);
      remoteOwned.delete(id);
      removed = true;
    }
  if (removed) revision.value++;
  remote.clear();
  for (const id of seen) remote.add(id);
}
