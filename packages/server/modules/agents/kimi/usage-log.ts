import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type {
  UsageLogEvent,
  UsageLogReader,
  UsageTokens,
} from "@ai-projector/core/modules/usage-analytics/index.ts";
import { os } from "@ai-projector/core/modules/os/index.ts";
import { walkFiles } from "../../usage-log/index.ts";

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

const text = (value: unknown): string => (typeof value === "string" ? value : "");

function tokensOf(usage: Record<string, unknown>): UsageTokens {
  return {
    input: count(usage.inputOther ?? usage.input_other),
    output: count(usage.output),
    cacheRead: count(usage.inputCacheRead ?? usage.input_cache_read),
    cacheWrite: count(usage.inputCacheCreation ?? usage.input_cache_creation),
  };
}

/** A Kimi session directory is named `session_<uuid>`; subagents live under its `agents/`. */
function sessionOf(file: string): string {
  let directory = dirname(file);
  while (directory !== dirname(directory)) {
    const name = basename(directory);
    if (name.startsWith("session_")) return name;
    directory = dirname(directory);
  }
  return basename(dirname(dirname(dirname(file))));
}

/** Kimi stores the workspace of a session in `state.json` next to the `agents` directory. */
async function cwdOf(file: string): Promise<string> {
  const sessionDirectory = dirname(dirname(dirname(file)));
  try {
    const state = record(
      JSON.parse(await readFile(join(sessionDirectory, "state.json"), "utf8")) as unknown,
    );
    return text(state?.cwd);
  } catch {
    return "";
  }
}

/**
 * Kimi appends `usage.record` lines to the wire log of every agent. Only turn-scoped records are
 * per request; session-scoped ones repeat the running total and would count the same work twice.
 * Older builds call the same counters `StatusUpdate.token_usage`.
 */
export async function readKimiUsage(file: string): Promise<UsageLogEvent[]> {
  const body = await readFile(file, "utf8");
  const session = sessionOf(file);
  const agentId = basename(dirname(file));
  const cwd = await cwdOf(file);
  const events: UsageLogEvent[] = [];
  for (const [index, line] of body.split("\n").entries()) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = record(JSON.parse(line) as unknown) ?? {};
    } catch {
      continue;
    }
    const usage = record(entry.usage) ?? record(entry.token_usage);
    if (!usage) continue;
    const scope = text(entry.usageScope) || text(entry.usage_scope);
    // A session total would be added to the per-turn events and double the answer.
    if (scope && scope !== "turn") continue;
    if (entry.type !== "usage.record" && !record(entry.token_usage)) continue;
    const tokens = tokensOf(usage);
    if (tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite === 0) continue;
    const at =
      number(entry.time) ??
      number(entry.timestamp) ??
      (typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN);
    if (!Number.isFinite(at)) continue;
    const model = text(entry.model);
    events.push({
      session,
      event: `${agentId}:${index}`,
      at,
      ...(model ? { model } : {}),
      ...(cwd ? { cwd } : {}),
      tokens,
      costSource: "none",
    });
  }
  return events;
}

const kimiRoots = () => [
  join(os.homeDirectory(), ".kimi", "sessions"),
  join(os.homeDirectory(), ".kimi-code", "sessions"),
];

export const kimiUsageLog: UsageLogReader = {
  agent: "kimi",
  label: "Kimi",
  roots: kimiRoots,
  async files() {
    const found: string[] = [];
    for (const root of kimiRoots())
      found.push(...(await walkFiles(root, (name) => name === "wire.jsonl", 6)));
    return found.sort();
  },
  read: readKimiUsage,
};
