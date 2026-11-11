import {
  listAgentBackends,
  registerAgentBackend,
  unregisterAgentBackend,
  type AgentBackend,
} from "../modules/agent/index.ts";
import { configureAgentPreferences } from "../modules/preferences/index.ts";
import { configureTerminalPrograms } from "../modules/terminal/index.ts";
import { claudeCodeBackend } from "../modules/agents/claude-code/index.ts";
import { codexBackend, codexUsageLog } from "../modules/agents/codex/index.ts";
import { kimiBackend, kimiUsageLog } from "../modules/agents/kimi/index.ts";
import { opencodeBackend, opencodeUsageLog } from "../modules/agents/opencode/index.ts";
import { createPluginAgent, loadCodeAgents } from "../modules/agents/plugin/index.ts";
import { projectorBackend } from "../modules/agents/projector/index.ts";
import {
  configurePluginAgents,
  discoverPlugins,
  type PluginAgentCandidate,
  type PluginAgentDiagnostic,
} from "../modules/plugins/index.ts";
import { registerUsageLogReader } from "../modules/usage-log/index.ts";
import { registerBuiltinAgentFeatures } from "./features.ts";

/** Plugin agent id → package id. Built-ins are everything else in the registry. */
const pluginAgents = new Map<string, string>();
let ready: Promise<void> | undefined;

/**
 * The agents this server offers. The composition is the only place that names them: each agent
 * module stays independent and the generic core never imports one. Registering again replaces.
 */
export function registerBuiltinAgents(): void {
  registerAgentBackend(projectorBackend, { asDefault: true });
  registerAgentBackend(claudeCodeBackend);
  registerAgentBackend(codexBackend);
  registerAgentBackend(opencodeBackend);
  registerAgentBackend(kimiBackend);
  // Native journals: analytics counts what the agents wrote outside the chat as well.
  registerUsageLogReader(codexUsageLog);
  registerUsageLogReader(opencodeUsageLog);
  registerUsageLogReader(kimiUsageLog);
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
  configurePluginAgents(applyPluginAgents);
  ready = undefined;
  void syncPluginAgents();
}

interface ResolvedAgent {
  candidate: PluginAgentCandidate;
  backend: AgentBackend;
}

function pluginProgram(candidate: PluginAgentCandidate): string {
  return candidate.agent.program ?? candidate.agent.id;
}

/** Fills presentation and limits the manifest declared but the code backend may have left out. */
function applyDescriptor(backend: AgentBackend, candidate: PluginAgentCandidate): void {
  const { agent } = candidate;
  if (!backend.caption && agent.caption) backend.caption = agent.caption;
  if (!backend.icon && agent.icon) backend.icon = agent.icon;
  if (agent.usage?.kind === "command" && !backend.usage) {
    backend.usage = agent.usage;
    backend.usageUrl = `/api/agent/usage/${encodeURIComponent(agent.id)}`;
  }
}

/** Reconciles the registry with the enabled, trusted plugin agents. */
async function applyPluginAgents(
  candidates: PluginAgentCandidate[],
): Promise<PluginAgentDiagnostic[]> {
  const diagnostics: PluginAgentDiagnostic[] = [];
  const byPlugin = new Map<string, PluginAgentCandidate[]>();
  for (const candidate of candidates) {
    const list = byPlugin.get(candidate.plugin) ?? [];
    list.push(candidate);
    byPlugin.set(candidate.plugin, list);
  }
  const resolved: ResolvedAgent[] = [];
  for (const [plugin, list] of byPlugin) {
    const server = list[0]?.server;
    if (!server) {
      for (const candidate of list)
        try {
          resolved.push({ candidate, backend: createPluginAgent(candidate.agent) });
        } catch (error) {
          diagnostics.push({
            plugin,
            agent: candidate.agent.id,
            message:
              error instanceof Error ? error.message : "Не удалось подготовить агента плагина",
          });
        }
      continue;
    }
    try {
      const backends = await loadCodeAgents(server, list[0]?.hash);
      const declared = new Map(list.map((candidate) => [candidate.agent.id, candidate]));
      for (const backend of backends) {
        const candidate = declared.get(backend.id);
        if (!candidate) {
          diagnostics.push({
            plugin,
            agent: backend.id,
            message: "Код плагина вернул агента, которого нет в манифесте",
          });
          continue;
        }
        applyDescriptor(backend, candidate);
        resolved.push({ candidate, backend });
      }
      for (const candidate of list)
        if (!backends.some((backend) => backend.id === candidate.agent.id))
          diagnostics.push({
            plugin,
            agent: candidate.agent.id,
            message: "Код плагина не вернул заявленного агента",
          });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось загрузить код плагина";
      for (const candidate of list)
        diagnostics.push({ plugin, agent: candidate.agent.id, message });
    }
  }

  const builtins = listAgentBackends().filter(({ id }) => !pluginAgents.has(id));
  const usedIds = new Set(builtins.map(({ id }) => id));
  const usedPrograms = new Set(builtins.flatMap(({ program }) => (program ? [program] : [])));
  const accepted = new Map<string, ResolvedAgent>();
  for (const entry of resolved) {
    const id = entry.backend.id;
    const program = entry.backend.program ?? pluginProgram(entry.candidate);
    if (usedIds.has(id)) {
      diagnostics.push({
        plugin: entry.candidate.plugin,
        agent: id,
        message: `Идентификатор агента уже занят: ${id}`,
      });
      continue;
    }
    if (usedPrograms.has(program)) {
      diagnostics.push({
        plugin: entry.candidate.plugin,
        agent: id,
        message: `Терминальная программа уже занята: ${program}`,
      });
      continue;
    }
    usedIds.add(id);
    usedPrograms.add(program);
    accepted.set(id, entry);
  }

  for (const id of pluginAgents.keys()) {
    if (accepted.has(id)) continue;
    try {
      unregisterAgentBackend(id);
    } catch (error) {
      diagnostics.push({
        plugin: pluginAgents.get(id) ?? "",
        agent: id,
        message: error instanceof Error ? error.message : "Не удалось убрать агента",
      });
    }
    pluginAgents.delete(id);
  }
  for (const [id, entry] of accepted) {
    try {
      registerAgentBackend(entry.backend);
      pluginAgents.set(id, entry.candidate.plugin);
    } catch (error) {
      diagnostics.push({
        plugin: entry.candidate.plugin,
        agent: id,
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
