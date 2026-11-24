import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { AgentBackend } from "../../agent/index.ts";
import {
  agentEnv,
  assertHostProject,
  attachedImages,
  createReplay,
  promptWithHistory,
  registerInjector,
  runHostedAgent,
  SESSION_LIST_LIMIT,
  type AgentRunHandle,
  type AgentRunOptions,
} from "../../agent/index.ts";
import { featureEnabled, featurePrompt } from "../../agent-features/index.ts";
import { roleContext } from "../../agent-roles/index.ts";
import {
  mcpConfigsForNames,
  mcpServerConfigs,
  type McpServerConfig,
} from "../../agent-mcp/index.ts";
import { trustedProjectWidgets } from "../../project-widgets/index.ts";
import { addPluginRoute, type PluginRouteRegistration } from "../../plugin-routes/index.ts";
import { assertUsageNetworkContext } from "../../network/index.ts";
import { type PluginHttpContribution } from "@ai-projector/core/modules/plugins/index.ts";
import { renderWidgetGuide } from "@ai-projector/core/modules/widget-catalog/index.ts";
import { clearSessionEnv } from "@ai-projector/core/modules/os/index.ts";
import { ideMcpServer } from "../ide-mcp/index.ts";
import {
  registerBalanceResolver,
  type ProviderBalanceContext,
  type ProviderBalanceReading,
} from "../../providers/index.ts";
import {
  createAcpBackend,
  createPlainDialect,
  extendPlainDialect,
  inputOf,
  isOver,
  readCompaction,
  shorten,
  uuidV7Time,
} from "../acp/index.ts";

/** The answer's history type, as `AgentRunOptions` spells it. */
type AgentHistory = NonNullable<AgentRunOptions["history"]>;

/** Host services a trusted agent plugin may call; the plugin stays a module of its own. */
export interface PluginHostApi {
  /** The environment of an external coding agent, without Projector's own secrets. */
  env(): Record<string, string | undefined>;
  /** Removes session-bound variables a parent agent exported, as the server does at startup. */
  clearEnv(names: readonly string[]): string[];
  /** Refuses isolating environments: tools run on the user's machine. */
  assertProject(cwd: string, label: string): Promise<void>;
  /** Bytes of the images the user attached to the message. */
  attachedImages(
    parts: AgentRunOptions["parts"],
  ): Promise<{ name: string; mime: string; data: string }[]>;
  /** The earlier chat as text, so an agent without a native session still knows it. */
  promptWithHistory(message: string, history: AgentHistory, context?: string): string;
  /** A follow-up the user writes during the answer; returns how to stop listening. */
  registerInjector(
    messageId: string,
    deliver: (text: string, inputId?: string) => boolean | Promise<boolean>,
  ): (() => void) | undefined;
  /** The chat shape of a stored transcript, filled by the plugin's parser. */
  createReplay(agent: string, sessionId: string): ReturnType<typeof createReplay>;
  readonly sessionListLimit: number;
  /**
   * Runs this answer in its own process, so a server restart or a HMR reload leaves it going.
   * The plugin backend calls it when the route supplied a run handle.
   */
  runHosted(
    options: AgentRunOptions,
    handle: AgentRunHandle,
    agentId: string,
    injectable?: string,
  ): Promise<void>;
}

/** The abilities the chat switched on for an agent, with the catalog's own texts. */
export interface PluginFeatureApi {
  enabled(agentId: string, featureId: string, features?: string[]): Promise<boolean>;
  prompt(agentId: string, features?: string[], extra?: string): Promise<string>;
}

/** The chat role: its instructions and the files of its skills. */
export interface PluginRoleApi {
  context(role: AgentRunOptions["role"], cwd?: string): Promise<string>;
}

/** Project widgets: only the user's trusted definitions reach an agent. */
export interface PluginWidgetApi {
  trustedProject(projectId?: string): Promise<unknown[]>;
  /** The instructions a model reads to write those widgets in markdown. */
  guide(widgets: readonly unknown[]): string;
}

/** MCP servers of the user, the project and Projector itself. */
export interface PluginMcpApi {
  configs(cwd?: string): Promise<McpServerConfig[]>;
  byNames(configs: readonly McpServerConfig[], names?: readonly string[]): McpServerConfig[];
  /** The stdio server of the IDE command registry. */
  ide(projectId: string): {
    name: string;
    command: string;
    args: string[];
    env: Record<string, string>;
  };
}

/** One provider kind a plugin brings a money-balance reader for. */
export interface PluginBalanceProvider {
  kind: string;
  read(context: ProviderBalanceContext): Promise<ProviderBalanceReading> | ProviderBalanceReading;
}

/** Provider services a trusted plugin may register; the kind must be in the manifest. */
export interface PluginProviderApi {
  registerBalance(provider: PluginBalanceProvider): void;
}

/** HTTP routes a trusted plugin serves under its own `/api/plugins/<key>/` prefix. */
export interface PluginHttpApi {
  register(route: PluginRouteRegistration): void;
}

/** Network checks owned by the server, so a plugin never probes the region itself. */
export interface PluginNetworkApi {
  /**
   * Resolves when usage requests are allowed from the current region (EU or USA) and rejects
   * otherwise. The probe and its policy stay in Projector; a plugin only waits for the answer.
   */
  assertUsageRegion(timeoutMs?: number): Promise<void>;
}

/** The narrow runtime a trusted server-side plugin receives; types are its own business. */
export interface PluginCodeApi {
  version: 1;
  /** Loads a package from the plugin's own `node_modules`, not from the IDE's. */
  require(specifier: string): unknown;
  createAcpBackend: typeof createAcpBackend;
  acp: {
    createPlainDialect: typeof createPlainDialect;
    extendPlainDialect: typeof extendPlainDialect;
    inputOf: typeof inputOf;
    isOver: typeof isOver;
    readCompaction: typeof readCompaction;
    shorten: typeof shorten;
    uuidV7Time: typeof uuidV7Time;
  };
  host: PluginHostApi;
  features: PluginFeatureApi;
  roles: PluginRoleApi;
  widgets: PluginWidgetApi;
  mcp: PluginMcpApi;
  network: PluginNetworkApi;
  providers: PluginProviderApi;
  http: PluginHttpApi;
}

/** A balance kind declared by the package; the runtime checks registrations against it. */
export interface PluginBalanceDeclaration {
  kind: string;
  title?: string;
  description?: string;
  url?: string;
  model?: string;
}

export interface PluginCodeLoadOptions {
  /** Package id; absent in the isolated runner, where balance registration is not used. */
  plugin?: string;
  /** `contributes.balances` of the package. */
  balances?: readonly PluginBalanceDeclaration[];
  /** `contributes.http` of the package; routes are served only in the server process. */
  http?: readonly PluginHttpContribution[];
}

const requirePlugin = createRequire(import.meta.url);
const loaded = new Map<string, Promise<Record<string, unknown>>>();
const balanceDisposers = new Map<string, Set<() => void>>();

/** The generic process that loads a plugin and runs one of its answers without hosting again. */
const RUNNER = fileURLToPath(new URL("../../../app/plugin-runner.ts", import.meta.url));

/** Removes the balance readers a disabled or reloaded package registered. */
export function clearPluginBalances(plugin: string): void {
  const disposers = balanceDisposers.get(plugin);
  if (!disposers) return;
  for (const dispose of disposers) dispose();
  balanceDisposers.delete(plugin);
}

/**
 * Loads a package's `server.js`, asks it for the agents and balance readers it contributes, and
 * reconciles both registries. The module import is cached by content hash; the factory runs on
 * every reconcile so disabling and re-enabling a package re-registers its readers. This executes
 * plugin code in the server process and is only reached after trust and enable.
 */
export async function loadCodeAgents(
  entry: string,
  hash?: string,
  options: PluginCodeLoadOptions = {},
): Promise<AgentBackend[]> {
  if (options.plugin) clearPluginBalances(options.plugin);
  const key = `${entry}\n${hash ?? ""}`;
  let pending = loaded.get(key);
  if (!pending) {
    // The package builds to CommonJS on purpose: a computed dynamic `import()` is forbidden by
    // the architecture rule, while `createRequire` still loads an arbitrary trusted entry path.
    delete requirePlugin.cache[entry];
    pending = Promise.resolve(requirePlugin(entry) as Record<string, unknown>);
    loaded.set(key, pending);
    pending.catch(() => loaded.delete(key));
  }
  const module = await pending;
  const usesCreatePlugin = typeof module.createPlugin === "function";
  const factory = module.createPlugin ?? module.createAgents ?? module.default;
  if (typeof factory !== "function")
    throw new Error("Плагин не экспортирует createPlugin(api) или createAgents(api)");
  const declared = new Map((options.balances ?? []).map((item) => [item.kind, item]));
  const declaredRoutes = new Map((options.http ?? []).map((route) => [route.id, route]));
  const registeredRoutes = new Set<string>();
  const registerRoute = (registration: PluginRouteRegistration): void => {
    if (
      !registration ||
      typeof registration.id !== "string" ||
      typeof registration.handle !== "function"
    )
      throw new Error("Плагин вернул некорректный маршрут");
    if (registeredRoutes.has(registration.id))
      throw new Error(`Маршрут ${registration.id} уже зарегистрирован`);
    registeredRoutes.add(registration.id);
    // The isolated runner loads the same package for one agent answer; it serves no HTTP.
    if (!options.plugin) return;
    const declaration = declaredRoutes.get(registration.id);
    if (!declaration) throw new Error(`Маршрут ${registration.id} не объявлен в contributes.http`);
    addPluginRoute(options.plugin, declaration, registration.handle);
  };
  const registeredKinds = new Set<string>();
  const registerBalance = (provider: PluginBalanceProvider): void => {
    if (!provider || typeof provider.kind !== "string" || typeof provider.read !== "function")
      throw new Error("Плагин вернул некорректный провайдер баланса");
    const declaration = declared.get(provider.kind);
    if (options.balances && !declaration)
      throw new Error(`Вид ${provider.kind} не объявлен в contributes.balances`);
    registeredKinds.add(provider.kind);
    const dispose = registerBalanceResolver({
      kind: provider.kind,
      read: (context) => provider.read(context),
      ...(declaration?.title ? { title: declaration.title } : {}),
      ...(declaration?.description ? { description: declaration.description } : {}),
      ...(declaration?.url ? { url: declaration.url } : {}),
      ...(declaration?.model ? { model: declaration.model } : {}),
      ...(options.plugin ? { plugin: options.plugin } : {}),
    });
    if (options.plugin) {
      const set = balanceDisposers.get(options.plugin) ?? new Set<() => void>();
      set.add(dispose);
      balanceDisposers.set(options.plugin, set);
    }
  };
  const requireEntry = createRequire(entry);
  const api: PluginCodeApi = {
    version: 1,
    require: (specifier) => requireEntry(specifier) as unknown,
    createAcpBackend,
    acp: {
      createPlainDialect,
      extendPlainDialect,
      inputOf,
      isOver,
      readCompaction,
      shorten,
      uuidV7Time,
    },
    host: {
      env: agentEnv,
      clearEnv: (names) => clearSessionEnv(names),
      assertProject: assertHostProject,
      attachedImages,
      promptWithHistory: (message, history, context) =>
        promptWithHistory(message, history, context),
      registerInjector,
      createReplay,
      sessionListLimit: SESSION_LIST_LIMIT,
      runHosted: (options, handle, agentId, injectable) => {
        if (!options.cwd) throw new Error("Агент работает внутри проекта: откройте чат в проекте");
        return runHostedAgent(
          options,
          handle,
          {
            runner: RUNNER,
            cwd: options.cwd,
            env: {
              ...agentEnv(),
              PROJECTOR_PLUGIN_ENTRY: entry,
              PROJECTOR_PLUGIN_HASH: hash ?? "",
              PROJECTOR_PLUGIN_AGENT: agentId,
            },
          },
          injectable,
        );
      },
    },
    features: { enabled: featureEnabled, prompt: featurePrompt },
    roles: { context: roleContext },
    widgets: {
      trustedProject: (projectId) => trustedProjectWidgets(projectId),
      guide: (widgets) => renderWidgetGuide(widgets as Parameters<typeof renderWidgetGuide>[0]),
    },
    mcp: {
      configs: (cwd) => mcpServerConfigs(cwd),
      byNames: (configs, names) => mcpConfigsForNames(configs, names),
      ide: ideMcpServer,
    },
    network: {
      assertUsageRegion: (timeoutMs = 10_000) => assertUsageNetworkContext(timeoutMs),
    },
    providers: { registerBalance },
    http: { register: registerRoute },
  };
  const result = (await factory(api)) as unknown;
  const moduleResult =
    result && typeof result === "object" && !Array.isArray(result)
      ? (result as { agents?: unknown; balances?: unknown })
      : null;
  const agents = Array.isArray(result)
    ? result
    : usesCreatePlugin || (options.http?.length && result === undefined)
      ? ((moduleResult?.agents as unknown) ?? [])
      : undefined;
  const balances = Array.isArray(result) ? [] : moduleResult?.balances;
  if (!Array.isArray(agents))
    throw new Error(
      "createPlugin(api) должен вернуть массив агентов или объект { agents, balances }",
    );
  if (Array.isArray(balances))
    for (const provider of balances) registerBalance(provider as PluginBalanceProvider);
  const missing = [...declared.keys()].filter((kind) => !registeredKinds.has(kind));
  if (missing.length)
    throw new Error(`Плагин не зарегистрировал баланс для видов: ${missing.join(", ")}`);
  const missingRoutes = [...declaredRoutes.keys()].filter((id) => !registeredRoutes.has(id));
  if (missingRoutes.length)
    throw new Error(`Плагин не зарегистрировал маршруты: ${missingRoutes.join(", ")}`);
  for (const item of agents) {
    const backend = item as Partial<AgentBackend> | null;
    if (
      !backend ||
      typeof backend !== "object" ||
      typeof backend.id !== "string" ||
      typeof backend.label !== "string" ||
      typeof backend.run !== "function"
    )
      throw new Error("Плагин вернул некорректного агента");
  }
  return agents as AgentBackend[];
}
