import type { UsageLogReader } from "@ai-projector/core/modules/usage-analytics/index.ts";

export { walkFiles } from "./walk.ts";

/**
 * Native journal readers join at runtime, the same way agent backends do: the composition names
 * concrete agents, and analytics never imports one module just to know where its logs live.
 */
const readers = new Map<string, UsageLogReader>();

/** Registers a reader by agent id; registering again replaces the previous one. */
export function registerUsageLogReader(reader: UsageLogReader): void {
  readers.set(reader.agent, reader);
}

/** Drops one agent's reader when its backend leaves the registry. */
export function unregisterUsageLogReader(agent: string): void {
  readers.delete(agent);
}

/** The readers the running server will scan, sorted by agent id for stable answers. */
export function usageLogReaders(): UsageLogReader[] {
  return [...readers.values()].sort((a, b) => a.agent.localeCompare(b.agent));
}

/** Drops every reader: tests use it, HMR never needs to because registration replaces. */
export function resetUsageLogReaders(): void {
  readers.clear();
}
