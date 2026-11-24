import { DatabaseSync } from "node:sqlite";
import { basename, join, resolve } from "node:path";
import type {
  UsageLogEvent,
  UsageLogReader,
  UsageTokens,
} from "@ai-projector/core/modules/usage-analytics/index.ts";
import { os } from "@ai-projector/core/modules/os/index.ts";
import { walkFiles } from "../../usage-log/index.ts";
import {
  blob,
  generationMetadata,
  isConcreteModel,
  MODEL_IDS,
  numberAt,
  textAt,
  tokensOf,
  trajectoryTimestamp,
  type GenerationMetadata,
} from "./usage-proto.ts";

interface Candidate {
  session: string;
  event: string;
  at: number;
  timestampQuality: number;
  model: string;
  modelId: number;
  modelQuality: number;
  keys: string[];
  tokens: UsageTokens;
}

function readRows(
  db: DatabaseSync,
  query: string,
  step: boolean,
): Array<{ idx: number; entry: GenerationMetadata }> {
  const rows = db.prepare(query).all() as Array<{ idx: unknown; data: unknown }>;
  const entries: Array<{ idx: number; entry: GenerationMetadata }> = [];
  for (const row of rows) {
    if (step && row.data == null) continue;
    if (typeof row.idx !== "number") continue;
    try {
      entries.push({ idx: row.idx, entry: generationMetadata(blob(row.data), step) });
    } catch {
      // A damaged row must not block the rest of the conversation database.
    }
  }
  return entries.sort((a, b) => a.idx - b.idx);
}

function candidatesOf(
  session: string,
  generations: Array<{ idx: number; entry: GenerationMetadata }>,
  steps: Array<{ idx: number; entry: GenerationMetadata }>,
  trajectoryAt: number | null,
  fallbackAt: number,
): Candidate[] {
  const result: Candidate[] = [];
  const generationModels = new Map(generations.map(({ idx, entry }) => [idx, entry]));
  for (const [source, entries] of [
    ["step", steps],
    ["generation", generations],
  ] as const) {
    for (const [index, { idx, entry }] of entries.entries()) {
      for (const [usageIndex, usage] of entry.usages.entries()) {
        const modelId = numberAt(usage, 1) || entry.modelId;
        const generation = source === "step" ? generationModels.get(idx) : undefined;
        const matches = (meta: GenerationMetadata) => modelId === 0 || meta.modelId === modelId;
        const model =
          matches(entry) && entry.model
            ? entry.model
            : generation && matches(generation)
              ? generation.model
              : "";
        const tokens = tokensOf(usage);
        if (tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite === 0) continue;
        const keys = ([11, 12, 7] as const).flatMap((key) => {
          const id = textAt(usage, key);
          return id ? [`antigravity:${key}:${id}`] : [];
        });
        result.push({
          session,
          event: keys[0] ?? `antigravity:${session}:${source}:${index}:${usageIndex}`,
          at: entry.timestampMs ?? trajectoryAt ?? fallbackAt,
          timestampQuality: entry.timestampMs !== null ? 2 : trajectoryAt !== null ? 1 : 0,
          model,
          modelId,
          modelQuality: isConcreteModel(model) ? 4 : model ? 1 : 0,
          keys,
          tokens,
        });
      }
    }
  }
  return result;
}

/** Dedupes step/generation duplicates that share a provider request id. */
function mergeCandidates(candidates: Candidate[]): Candidate[] {
  type Group = Candidate & { parent: number; size: number };
  const groups: Group[] = candidates.map((candidate, index) => ({
    ...candidate,
    parent: index,
    size: 1,
  }));
  const identities = new Map<string, number>();
  const find = (index: number): number => {
    let root = index;
    while (groups[root]!.parent !== root) root = groups[root]!.parent;
    while (index !== root) {
      const parent = groups[index]!.parent;
      groups[index]!.parent = root;
      index = parent;
    }
    return root;
  };
  const merge = (left: number, right: number) => {
    let a = find(left);
    let b = find(right);
    if (a === b) return;
    if (groups[a]!.size < groups[b]!.size) [a, b] = [b, a];
    const target = groups[a]!;
    const source = groups[b]!;
    const first = a < b ? target : source;
    const bestModel =
      source.modelQuality === target.modelQuality
        ? first
        : source.modelQuality > target.modelQuality
          ? source
          : target;
    const bestTime =
      source.timestampQuality > target.timestampQuality ||
      (source.timestampQuality === target.timestampQuality && source.at < target.at)
        ? source
        : target;
    const x = target.tokens;
    const y = source.tokens;
    target.model = bestModel.model;
    target.modelQuality = bestModel.modelQuality;
    target.at = bestTime.at;
    target.timestampQuality = bestTime.timestampQuality;
    target.event = first.event;
    target.tokens = {
      input: Math.max(x.input, y.input),
      output: Math.max(x.output, y.output),
      cacheRead: Math.max(x.cacheRead, y.cacheRead),
      cacheWrite: Math.max(x.cacheWrite, y.cacheWrite),
    };
    target.size += source.size;
    source.parent = a;
  };
  for (const [index, candidate] of candidates.entries()) {
    for (const key of candidate.keys) {
      const existing = identities.get(key);
      if (existing !== undefined) merge(index, existing);
      identities.set(key, index);
    }
  }
  return groups.filter((group, index) => group.parent === index);
}

function resolveModel(candidate: Candidate, learned: Map<number, string | null>): string {
  if (candidate.modelQuality === 4) return candidate.model;
  const known = learned.get(candidate.modelId);
  if (known) return known;
  const fallback = MODEL_IDS[candidate.modelId];
  if (fallback) return fallback;
  return (
    candidate.model ||
    (candidate.modelId > 0 ? `antigravity-model-${candidate.modelId}` : "antigravity-unknown")
  );
}

/** One Antigravity conversation database (`*.db` under `~/.gemini/antigravity-cli/conversations`). */
export function readAntigravityUsageFile(file: string, mtimeMs = Date.now()): UsageLogEvent[] {
  const session = basename(file, ".db");
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { readOnly: true, timeout: 100 });
    const tables = new Set(
      (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
          name: string;
        }>
      ).map((row) => row.name),
    );
    if (!tables.has("gen_metadata") && !tables.has("steps")) return [];
    const generations = tables.has("gen_metadata")
      ? readRows(db, "SELECT idx, data FROM gen_metadata ORDER BY idx", false)
      : [];
    let trajectoryAt: number | null = null;
    if (tables.has("trajectory_metadata_blob")) {
      const rows = db.prepare("SELECT data FROM trajectory_metadata_blob").all() as Array<{
        data: unknown;
      }>;
      for (const row of rows) {
        if (trajectoryAt !== null) break;
        try {
          trajectoryAt = trajectoryTimestamp(blob(row.data));
        } catch {
          // Ignore malformed trajectory metadata rows.
        }
      }
    }
    const steps = tables.has("steps")
      ? readRows(db, "SELECT idx, metadata AS data FROM steps ORDER BY idx", true)
      : [];
    const learned = new Map<number, string | null>();
    for (const { entry } of [...generations, ...steps]) {
      if (entry.modelId > 0 && isConcreteModel(entry.model)) {
        const previous = learned.get(entry.modelId);
        learned.set(
          entry.modelId,
          previous === undefined || previous === entry.model ? entry.model : null,
        );
      }
    }
    return mergeCandidates(candidatesOf(session, generations, steps, trajectoryAt, mtimeMs)).map(
      (candidate) => ({
        session: candidate.session,
        event: candidate.event,
        at: candidate.at,
        model: resolveModel(candidate, learned),
        tokens: candidate.tokens,
        costSource: "none" as const,
      }),
    );
  } finally {
    db?.close();
  }
}

const expandHome = (value: string, home: string): string =>
  value === "~"
    ? home
    : value.startsWith("~/") || value.startsWith("~\\")
      ? join(home, value.slice(2))
      : value;

const antigravityRoots = () => {
  const home = os.homeDirectory();
  const configured = process.env.ANTIGRAVITY_DATA_DIR?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (configured?.length) {
    return configured.flatMap((entry) => {
      const root = resolve(expandHome(entry, home));
      return [join(root, "conversations"), root];
    });
  }
  const names = ["antigravity", "antigravity-cli", "antigravity-ide", "antigravity-backup"];
  return [
    ...names.map((name) => join(home, ".gemini", name, "conversations")),
    ...names.map((name) => join(home, ".gemini", name)),
    join(home, ".config", "antigravity"),
  ];
};

export const antigravityUsageLog: UsageLogReader = {
  agent: "antigravity",
  label: "Antigravity",
  maxBytes: 4 * 1024 * 1024 * 1024,
  roots: antigravityRoots,
  async files() {
    const found = new Set<string>();
    for (const root of antigravityRoots()) {
      for (const file of await walkFiles(root, (name) => name.endsWith(".db"), 6)) {
        // Summaries and FTS indexes live next to conversations; only generation DBs have usage.
        if (basename(file) === "conversation_summaries.db") continue;
        found.add(file);
      }
    }
    return [...found].sort();
  },
  async read(file) {
    const { stat } = await import("node:fs/promises");
    const mtimeMs = await stat(file)
      .then((info) => info.mtimeMs)
      .catch(() => Date.now());
    return readAntigravityUsageFile(file, mtimeMs);
  },
};
