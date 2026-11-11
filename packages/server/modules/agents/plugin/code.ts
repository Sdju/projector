import { createRequire } from "node:module";
import type { AgentBackend } from "../../agent/index.ts";
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

/** The narrow runtime a trusted server-side plugin receives; types are its own business. */
export interface PluginCodeApi {
  version: 1;
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
}

const requirePlugin = createRequire(import.meta.url);
const loaded = new Map<string, Promise<Record<string, unknown>>>();

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
  const api: PluginCodeApi = {
    version: 1,
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
