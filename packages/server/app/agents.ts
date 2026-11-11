import {
  listAgentBackends,
  registerAgentBackend,
  unregisterAgentBackend,
} from "../modules/agent/index.ts";
import { configureAgentPreferences } from "../modules/preferences/index.ts";
import { configureTerminalPrograms } from "../modules/terminal/index.ts";
import { claudeCodeBackend } from "../modules/agents/claude-code/index.ts";
import { codexBackend, codexUsageLog } from "../modules/agents/codex/index.ts";
import { cursorBackend } from "../modules/agents/cursor/index.ts";
import { kimiBackend, kimiUsageLog } from "../modules/agents/kimi/index.ts";
import { opencodeBackend, opencodeUsageLog } from "../modules/agents/opencode/index.ts";
import { createPluginAgent } from "../modules/agents/plugin/index.ts";
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
  registerAgentBackend(cursorBackend);
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

/** Reconciles the registry with the enabled, trusted plugin agents. */
function applyPluginAgents(candidates: PluginAgentCandidate[]): PluginAgentDiagnostic[] {
  const diagnostics: PluginAgentDiagnostic[] = [];
  const builtins = listAgentBackends().filter(({ id }) => !pluginAgents.has(id));
  const usedIds = new Set(builtins.map(({ id }) => id));
  const usedPrograms = new Set(builtins.flatMap(({ program }) => (program ? [program] : [])));
  const accepted = new Map<string, PluginAgentCandidate>();
  for (const candidate of candidates) {
    const { agent } = candidate;
    const program = agent.program ?? agent.id;
    if (usedIds.has(agent.id)) {
      diagnostics.push({
        plugin: candidate.plugin,
        agent: agent.id,
        message: `Идентификатор агента уже занят: ${agent.id}`,
      });
      continue;
    }
    if (usedPrograms.has(program)) {
      diagnostics.push({
        plugin: candidate.plugin,
        agent: agent.id,
        message: `Терминальная программа уже занята: ${program}`,
      });
      continue;
    }
    usedIds.add(agent.id);
    usedPrograms.add(program);
    accepted.set(agent.id, candidate);
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
  for (const [id, candidate] of accepted) {
    try {
      registerAgentBackend(createPluginAgent(candidate.agent));
      pluginAgents.set(id, candidate.plugin);
    } catch (error) {
      diagnostics.push({
        plugin: candidate.plugin,
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
