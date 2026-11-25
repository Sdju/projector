import {
  isPluginIconFile,
  parseProjectPluginId,
  projectPluginId,
  type PluginAgentContribution,
} from "@ai-projector/core/modules/plugins/index.ts";
import { registerAgentBackend, unregisterAgentBackend, type AgentBackend } from "../agent/index.ts";
import { unregisterAcpProgram } from "../agents/acp/index.ts";
import { createPluginAgent, loadCodeAgents } from "../agents/plugin/index.ts";
import { readPluginIcon, type PluginInfo } from "../plugins/index.ts";
import { beginPluginRoutes, dropPluginRoutes } from "../plugin-routes/index.ts";

interface ProjectRuntime {
  signature: string;
  agents: string[];
  plugins: string[];
  diagnostics: Map<string, { message: string }[]>;
}

const host = globalThis as typeof globalThis & {
  projectorProjectPluginRuntime?: Map<string, ProjectRuntime>;
  projectorProjectPluginQueues?: Map<string, Promise<void>>;
};

function runtimes(): Map<string, ProjectRuntime> {
  return (host.projectorProjectPluginRuntime ??= new Map());
}

function queues(): Map<string, Promise<void>> {
  return (host.projectorProjectPluginQueues ??= new Map());
}

function cleanup(runtime: ProjectRuntime): void {
  for (const id of runtime.agents) {
    unregisterAcpProgram(id);
    try {
      unregisterAgentBackend(id);
    } catch {
      // Already replaced by a newer load or removed with the project.
    }
  }
  for (const plugin of runtime.plugins) dropPluginRoutes(plugin);
}

function disposeProjectRuntime(projectId: string): void {
  const current = runtimes().get(projectId);
  if (!current) return;
  cleanup(current);
  runtimes().delete(projectId);
}

/** Manifest presentation and limits fill what the code backend left out. */
async function applyDescriptor(
  backend: AgentBackend,
  agent: PluginAgentContribution,
  entry: PluginInfo,
  projectId: string,
): Promise<void> {
  backend.id = projectPluginId(projectId, agent.id);
  backend.projectId = projectId;
  if (!backend.caption && agent.caption) backend.caption = agent.caption;
  if (!backend.defaultFeatures?.length && agent.defaultFeatures?.length)
    backend.defaultFeatures = [...agent.defaultFeatures];
  if (agent.icon && isPluginIconFile(agent.icon)) {
    if (!entry.path) throw new Error("Нет каталога плагина для иконки агента");
    backend.iconSvg = await readPluginIcon(entry.path, agent.icon);
    delete backend.icon;
  } else if (!backend.icon && agent.icon) backend.icon = agent.icon;
  if (agent.usage?.kind === "command" && !backend.usage) backend.usage = agent.usage;
  if (backend.usage) backend.usageUrl = `/api/agent/usage/${encodeURIComponent(backend.id)}`;
}

function signatureOf(entries: PluginInfo[]): string {
  return entries
    .map((entry) =>
      [
        entry.id,
        entry.hash ?? "",
        entry.server ?? "",
        entry.agents.map((agent) => agent.id).join(","),
        entry.http.map((route) => route.id).join(","),
      ].join("\0"),
    )
    .sort()
    .join("\n");
}

function applySavedDiagnostics(runtime: ProjectRuntime, entries: PluginInfo[]): void {
  for (const entry of entries) {
    const saved = runtime.diagnostics.get(entry.id);
    if (!saved?.length) continue;
    entry.diagnostics.push(...saved);
    entry.status = "error";
  }
}

function manifestAgentId(backendId: string, projectId: string): string {
  const parsed = parseProjectPluginId(backendId);
  return parsed?.projectId === projectId ? parsed.packageName : backendId;
}

async function reconcileProjectPluginCode(projectId: string, entries: PluginInfo[]): Promise<void> {
  const candidates = entries.filter(
    (entry) =>
      entry.status === "enabled" &&
      entry.trusted &&
      entry.diagnostics.length === 0 &&
      (entry.agents.length > 0 || (!!entry.server && entry.http.length > 0)),
  );
  const signature = signatureOf(candidates);
  const current = runtimes().get(projectId);
  if (current?.signature === signature) {
    applySavedDiagnostics(current, candidates);
    return;
  }
  disposeProjectRuntime(projectId);
  const runtime: ProjectRuntime = {
    signature,
    agents: [],
    plugins: [],
    diagnostics: new Map(),
  };

  for (const entry of candidates) {
    const plugin = entry.id;
    beginPluginRoutes(plugin);
    const registered: string[] = [];
    const loadDiagnostics: { message: string }[] = [];
    try {
      if (entry.server) {
        const backends = await loadCodeAgents(entry.server, entry.hash, {
          plugin,
          http: entry.http,
          balances: [],
        });
        const declared = new Map(entry.agents.map((agent) => [agent.id, agent]));
        const returned = new Set<string>();
        for (const backend of backends) {
          const declaredId = manifestAgentId(backend.id, projectId);
          returned.add(declaredId);
          const agent = declared.get(declaredId);
          if (!agent) {
            loadDiagnostics.push({
              message: `Код плагина вернул агента, которого нет в манифесте: ${declaredId}`,
            });
            continue;
          }
          await applyDescriptor(backend, agent, entry, projectId);
          registerAgentBackend(backend);
          registered.push(backend.id);
        }
        for (const agent of entry.agents)
          if (!returned.has(agent.id))
            loadDiagnostics.push({
              message: `Код плагина не вернул заявленного агента: ${agent.id}`,
            });
      } else {
        for (const agent of entry.agents) {
          const scopedId = projectPluginId(projectId, agent.id);
          const backend = createPluginAgent({
            ...agent,
            id: scopedId,
            program: agent.program ?? agent.id,
          });
          await applyDescriptor(backend, agent, entry, projectId);
          registerAgentBackend(backend);
          registered.push(backend.id);
        }
      }
      runtime.plugins.push(plugin);
      runtime.agents.push(...registered);
    } catch (error) {
      dropPluginRoutes(plugin);
      for (const id of registered) {
        unregisterAcpProgram(id);
        try {
          unregisterAgentBackend(id);
        } catch {
          // Nothing was registered for this plugin yet.
        }
      }
      loadDiagnostics.push({
        message: error instanceof Error ? error.message : "Не удалось загрузить код плагина",
      });
    }
    if (loadDiagnostics.length) {
      runtime.diagnostics.set(entry.id, loadDiagnostics);
      entry.diagnostics.push(...loadDiagnostics);
      entry.status = "error";
    }
  }
  runtimes().set(projectId, runtime);
}

/**
 * Reconciles the project's trusted server agents and HTTP routes. The server has no single
 * "active project": the project id is part of every id, route prefix and agent, so two open
 * workspaces cannot replace each other's contributions. Calls for the same project are serialized
 * so concurrent catalog reads never observe a half-loaded runtime.
 */
export async function applyProjectPluginCode(
  projectId: string,
  entries: PluginInfo[],
): Promise<void> {
  const map = queues();
  const previous = map.get(projectId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => reconcileProjectPluginCode(projectId, entries));
  map.set(projectId, next);
  try {
    await next;
  } finally {
    if (map.get(projectId) === next) map.delete(projectId);
  }
}

/** Removes a project's agents and routes; called when trust is revoked or the project disappears. */
export function clearProjectPluginCode(projectId: string): void {
  disposeProjectRuntime(projectId);
}
