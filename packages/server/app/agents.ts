import {
  listAgentBackends,
  registerAgentBackend,
  unregisterAgentBackend,
  type AgentBackend,
} from "../modules/agent/index.ts";
import { configureAgentPreferences } from "../modules/preferences/index.ts";
import { configureTerminalPrograms } from "../modules/terminal/index.ts";
import { antigravityBackend } from "../modules/agents/antigravity/index.ts";
import { codexBackend } from "../modules/agents/codex/index.ts";
import { kimiBackend } from "../modules/agents/kimi/index.ts";
import { opencodeBackend } from "../modules/agents/opencode/index.ts";
import {
  clearPluginBalances,
  createPluginAgent,
  loadCodeAgents,
} from "../modules/agents/plugin/index.ts";
import { projectorBackend } from "../modules/agents/projector/index.ts";
import {
  isPluginIconFile,
  type PluginAgentContribution,
} from "@ai-projector/core/modules/plugins/index.ts";
import {
  configurePluginCode,
  discoverPlugins,
  readPluginIcon,
  type PluginCandidate,
  type PluginCodeDiagnostic,
} from "../modules/plugins/index.ts";
import { registerUsageLogReader, unregisterUsageLogReader } from "../modules/usage-log/index.ts";
import {
  beginPluginRoutes,
  dropPluginRoutes,
  pluginRoutePlugins,
} from "../modules/plugin-routes/index.ts";
import { registerBuiltinAgentFeatures } from "./features.ts";

/** Plugin agent id → package id. Built-ins are everything else in the registry. */
const pluginAgents = new Map<string, string>();
let ready: Promise<void> | undefined;

/** A backend that owns a native journal brings its analytics reader with it. */
function registerBackendUsageLog(backend: AgentBackend): void {
  if (!backend.usageLog) return;
  registerUsageLogReader({ ...backend.usageLog, agent: backend.id });
}

/**
 * The agents this server offers. The composition is the only place that names them: each agent
 * module stays independent and the generic core never imports one. Registering again replaces.
 */
export function registerBuiltinAgents(): void {
  const builtins = [
    projectorBackend,
    codexBackend,
    opencodeBackend,
    kimiBackend,
    antigravityBackend,
  ];
  registerAgentBackend(projectorBackend, { asDefault: true });
  for (const backend of builtins.slice(1)) registerAgentBackend(backend);
  // Native journals live on the backend itself: built-ins and plugin code use one path.
  for (const backend of builtins) registerBackendUsageLog(backend);
  // The settings ask the live registry instead of keeping their own copy of the list.
  configureAgentPreferences({
    programs: () => listAgentBackends().flatMap(({ program }) => (program ? [program] : [])),
    toggleable: () =>
      listAgentBackends()
        .filter(({ builtin }) => !builtin)
        .map(({ id }) => id),
  });
  // Terminal programs come from the same registry; no list of agents lives in the terminal.
  configureTerminalPrograms(
    (program) =>
      listAgentBackends().find((backend) => backend.terminal?.program === program)?.terminal,
  );
  // Plugin agents join the same registry. Discovery is async, so the first API request waits.
  configurePluginCode(applyPluginCatalog);
  ready = undefined;
  void syncPluginAgents();
}

interface ResolvedAgent {
  plugin: string;
  candidate: PluginCandidate;
  agent: PluginAgentContribution;
  backend: AgentBackend;
}

/** Fills presentation and limits the manifest declared but the code backend may have left out. */
async function applyDescriptor(
  backend: AgentBackend,
  candidate: PluginCandidate,
  agent: PluginAgentContribution,
): Promise<void> {
  if (!backend.defaultFeatures && agent.defaultFeatures?.length)
    backend.defaultFeatures = [...agent.defaultFeatures];
  if (!backend.caption && agent.caption) backend.caption = agent.caption;
  if (agent.icon && isPluginIconFile(agent.icon)) {
    if (!candidate.path) throw new Error("Нет каталога пакета для иконки агента");
    backend.iconSvg = await readPluginIcon(candidate.path, agent.icon);
    delete backend.icon;
  } else if (!backend.icon && agent.icon) backend.icon = agent.icon;
  if (agent.usage?.kind === "command" && !backend.usage) backend.usage = agent.usage;
  if (backend.usage) backend.usageUrl = `/api/agent/usage/${encodeURIComponent(agent.id)}`;
}

/** Plugins whose balance readers are currently registered; removed packages are cleaned up. */
const pluginBalances = new Set<string>();

/** Reconciles the registry with the enabled, trusted plugin code. */
async function applyPluginCatalog(candidates: PluginCandidate[]): Promise<PluginCodeDiagnostic[]> {
  const diagnostics: PluginCodeDiagnostic[] = [];
  const resolved: ResolvedAgent[] = [];
  for (const candidate of candidates) {
    const plugin = candidate.plugin;
    if (!candidate.server) {
      if (candidate.balances.length) {
        diagnostics.push({
          plugin,
          subject: candidate.balances[0]!.kind,
          message: "Вклады balances требуют projector.server",
        });
        continue;
      }
      for (const agent of candidate.agents)
        try {
          const backend = createPluginAgent(agent);
          await applyDescriptor(backend, candidate, agent);
          resolved.push({ plugin, candidate, agent, backend });
        } catch (error) {
          diagnostics.push({
            plugin,
            subject: agent.id,
            message:
              error instanceof Error ? error.message : "Не удалось подготовить агента плагина",
          });
        }
      continue;
    }
    try {
      beginPluginRoutes(plugin);
      const backends = await loadCodeAgents(candidate.server, candidate.hash, {
        plugin,
        balances: candidate.balances,
        http: candidate.http,
      });
      if (candidate.balances.length) pluginBalances.add(plugin);
      const declared = new Map(candidate.agents.map((agent) => [agent.id, agent]));
      for (const backend of backends) {
        const agent = declared.get(backend.id);
        if (!agent) {
          diagnostics.push({
            plugin,
            subject: backend.id,
            message: "Код плагина вернул агента, которого нет в манифесте",
          });
          continue;
        }
        await applyDescriptor(backend, candidate, agent);
        resolved.push({ plugin, candidate, agent, backend });
      }
      for (const agent of candidate.agents)
        if (!backends.some((backend) => backend.id === agent.id))
          diagnostics.push({
            plugin,
            subject: agent.id,
            message: "Код плагина не вернул заявленного агента",
          });
    } catch (error) {
      clearPluginBalances(plugin);
      pluginBalances.delete(plugin);
      dropPluginRoutes(plugin);
      const message = error instanceof Error ? error.message : "Не удалось загрузить код плагина";
      for (const agent of candidate.agents)
        diagnostics.push({ plugin, subject: agent.id, message });
      for (const balance of candidate.balances)
        diagnostics.push({ plugin, subject: balance.kind, message });
      for (const route of candidate.http) diagnostics.push({ plugin, subject: route.id, message });
    }
  }

  // A disabled, removed or broken package must not keep its balance reader in the process.
  const active = new Set(candidates.map((candidate) => candidate.plugin));
  for (const plugin of pluginBalances) {
    if (active.has(plugin)) continue;
    clearPluginBalances(plugin);
    pluginBalances.delete(plugin);
  }
  for (const plugin of pluginRoutePlugins()) {
    if (active.has(plugin)) continue;
    dropPluginRoutes(plugin);
  }

  const builtins = listAgentBackends().filter(({ id }) => !pluginAgents.has(id));
  const usedIds = new Set(builtins.map(({ id }) => id));
  const usedPrograms = new Set(builtins.flatMap(({ program }) => (program ? [program] : [])));
  const accepted = new Map<string, ResolvedAgent>();
  for (const entry of resolved) {
    const id = entry.backend.id;
    const program = entry.backend.program ?? entry.agent.program ?? entry.agent.terminal?.program;
    if (usedIds.has(id)) {
      diagnostics.push({
        plugin: entry.plugin,
        subject: id,
        message: `Идентификатор агента уже занят: ${id}`,
      });
      continue;
    }
    if (program !== undefined && usedPrograms.has(program)) {
      diagnostics.push({
        plugin: entry.plugin,
        subject: id,
        message: `Терминальная программа уже занята: ${program}`,
      });
      continue;
    }
    usedIds.add(id);
    if (program !== undefined) usedPrograms.add(program);
    accepted.set(id, entry);
  }

  for (const id of pluginAgents.keys()) {
    if (accepted.has(id)) continue;
    try {
      unregisterAgentBackend(id);
    } catch (error) {
      diagnostics.push({
        plugin: pluginAgents.get(id) ?? "",
        subject: id,
        message: error instanceof Error ? error.message : "Не удалось убрать агента",
      });
    } finally {
      unregisterUsageLogReader(id);
    }
    pluginAgents.delete(id);
  }
  for (const [id, entry] of accepted) {
    try {
      registerAgentBackend(entry.backend);
      registerBackendUsageLog(entry.backend);
      pluginAgents.set(id, entry.plugin);
    } catch (error) {
      diagnostics.push({
        plugin: entry.plugin,
        subject: id,
        message: error instanceof Error ? error.message : "Не удалось зарегистрировать агента",
      });
    }
  }
  registerBuiltinAgentFeatures();
  return diagnostics;
}

/** Loads the plugin catalog once and lets its agents join the registry. */
export function syncPluginAgents(): Promise<void> {
  ready = discoverPlugins()
    .then(() => undefined)
    .catch((error: unknown) => {
      console.error(
        "Плагины-агенты:",
        error instanceof Error ? error.message : "не удалось прочитать каталог",
      );
    });
  return ready;
}

/** The first API request waits for the plugin agents; tests without a composition resolve at once. */
export function ensureAgentsReady(): Promise<void> {
  return ready ?? Promise.resolve();
}
