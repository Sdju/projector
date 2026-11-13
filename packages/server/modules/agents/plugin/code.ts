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
import { renderWidgetGuide } from "@ai-projector/core/modules/widget-catalog/index.ts";
import { clearSessionEnv } from "@ai-projector/core/modules/os/index.ts";
import { ideMcpServer } from "../ide-mcp/index.ts";
import { widgetsMcpServer } from "../widgets-mcp/index.ts";
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
  /** The stdio server of the on-demand widget descriptions. */
  widgets(projectId?: string): {
    name: string;
    command: string;
    args: string[];
    env: Record<string, string>;
  };
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
}

const requirePlugin = createRequire(import.meta.url);
const loaded = new Map<string, Promise<Record<string, unknown>>>();

/** The generic process that loads a plugin and runs one of its answers without hosting again. */
const RUNNER = fileURLToPath(new URL("../../../app/plugin-runner.ts", import.meta.url));

/**
 * Loads a package's `server.js` and asks it for the agents it contributes. The module is cached by
 * its content hash, so a catalog refresh does not re-run plugin code; a new hash gets a new module.
 * This executes plugin code in the server process and is only reached after trust and enable.
 */
export async function loadCodeAgents(entry: string, hash?: string): Promise<AgentBackend[]> {
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
  const factory = module.createAgents ?? module.default;
  if (typeof factory !== "function") throw new Error("Плагин не экспортирует createAgents(api)");
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
      widgets: widgetsMcpServer,
    },
  };
  const result = (await factory(api)) as unknown;
  if (!Array.isArray(result)) throw new Error("createAgents(api) должен вернуть массив агентов");
  for (const item of result) {
    const backend = item as Partial<AgentBackend> | null;
    if (
      !backend ||
      typeof backend !== "object" ||
      typeof backend.id !== "string" ||
      typeof backend.label !== "string" ||
      typeof backend.run !== "function"
    )
      throw new Error("createAgents(api) вернул некорректного агента");
  }
  return result as AgentBackend[];
}
