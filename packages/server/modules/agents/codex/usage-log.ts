import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  UsageLogEvent,
  UsageLogRead,
  UsageLogReader,
  UsageTokens,
} from "@ai-projector/core/modules/usage-analytics/index.ts";
import { os } from "@ai-projector/core/modules/os/index.ts";
import { walkFiles } from "../../usage-log/index.ts";

type Entry = {
  type?: unknown;
  timestamp?: unknown;
  ordinal?: unknown;
  payload?: Record<string, unknown>;
};

interface Cursor {
  /** Byte after the last complete line. */
  offset: number;
  session: string;
  model: string;
  cwd: string;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

/** Session id of a rollout file when its metadata line is missing or unreadable. */
function sessionFromName(file: string): string {
  return basename(file, ".jsonl").replace(/^rollout-/, "");
}

/** Token counts of one request: Codex counts cached prompt tokens inside `input_tokens`. */
function tokensOf(usage: Record<string, unknown>): UsageTokens {
  const cacheRead = count(usage.cached_input_tokens);
  const cacheWrite = count(usage.cache_write_input_tokens);
  return {
    input: Math.max(0, count(usage.input_tokens) - cacheRead),
    output: count(usage.output_tokens),
    cacheRead,
    cacheWrite,
  };
}

const empty = (tokens: UsageTokens) =>
  tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite === 0;

function contextOf(state: string | undefined): Cursor | null {
  if (!state) return null;
  try {
    const value = record(JSON.parse(state) as unknown);
    if (!value || typeof value.offset !== "number") return null;
    if (typeof value.session !== "string" || !value.session) return null;
    return {
      offset: value.offset,
      session: value.session,
      model: typeof value.model === "string" ? value.model : "",
      cwd: typeof value.cwd === "string" ? value.cwd : "",
    };
  } catch {
    return null;
  }
}

/**
 * Codex writes one rollout per session and a `token_count` event after every request. The
 * `last_token_usage` is exactly that request; `total_token_usage` would count the session again
 * and again, so it is only a fallback for older files without the per-request field.
 *
 * Rollouts can be hundreds of megabytes, so the reader streams complete lines from the last
 * cursor instead of loading the file. Session, model and working directory travel in the cursor:
 * an appended `token_count` has no metadata of its own.
 */
export async function readCodexUsage(file: string, state?: string): Promise<UsageLogRead> {
  const stored = contextOf(state);
  const size = (await stat(file)).size;
  const resume = stored && stored.offset <= size ? stored : null;
  const events: UsageLogEvent[] = [];
  let session = resume?.session || sessionFromName(file);
  let model = resume?.model ?? "";
  let cwd = resume?.cwd ?? "";
  let nextLine = resume?.offset ?? 0;

  function line(raw: string, offset: number): void {
    if (!raw.trim()) return;
    // Most of a rollout is prompts and tool output; skip those lines before parsing their JSON.
    if (
      !raw.includes('"token_count"') &&
      !raw.includes('"session_meta"') &&
      !raw.includes('"turn_context"')
    )
      return;
    let entry: Entry;
    try {
      entry = JSON.parse(raw) as Entry;
    } catch {
      return;
    }
    const payload = record(entry.payload);
    if (!payload) return;
    if (entry.type === "session_meta") {
      if (typeof payload.id === "string" && payload.id) session = payload.id;
      else if (typeof payload.session_id === "string" && payload.session_id)
        session = payload.session_id;
      if (typeof payload.cwd === "string") cwd = payload.cwd;
      if (typeof payload.model === "string") model = payload.model;
      return;
    }
    if (entry.type === "turn_context") {
      if (typeof payload.model === "string" && payload.model) model = payload.model;
      if (typeof payload.cwd === "string" && payload.cwd) cwd = payload.cwd;
      return;
    }
    if (entry.type !== "event_msg" || payload.type !== "token_count") return;
    const info = record(payload.info);
    if (!info) return;
    const rawUsage = record(info.last_token_usage) ?? record(info.total_token_usage);
    if (!rawUsage) return;
    const tokens = tokensOf(rawUsage);
    if (empty(tokens)) return;
    const at = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
    if (!Number.isFinite(at)) return;
    events.push({
      session,
      event:
        typeof entry.ordinal === "number" && Number.isFinite(entry.ordinal)
          ? String(entry.ordinal)
          : String(offset),
      at,
      ...(model ? { model } : {}),
      ...(cwd ? { cwd } : {}),
      tokens,
      costSource: "none",
    });
  }

  let buffer = "";
  for await (const chunk of createReadStream(file, {
    start: nextLine,
    encoding: "utf8",
  })) {
    buffer += chunk;
    let end = buffer.indexOf("\n");
    while (end >= 0) {
      const raw = buffer.slice(0, end);
      const bytes = Buffer.byteLength(raw) + 1;
      buffer = buffer.slice(end + 1);
      line(raw.endsWith("\r") ? raw.slice(0, -1) : raw, nextLine);
      nextLine += bytes;
      end = buffer.indexOf("\n");
    }
  }
  return {
    events,
    state: JSON.stringify({ offset: nextLine, session, model, cwd } satisfies Cursor),
  };
}

/** Codex keeps live rollouts under `sessions` and moved ones under `archived_sessions`. */
const codexRoots = () => {
  const root = join(os.homeDirectory(), ".codex");
  return [join(root, "sessions"), join(root, "archived_sessions")];
};

export const codexUsageLog: UsageLogReader = {
  agent: "codex",
  label: "Codex",
  maxBytes: 4 * 1024 * 1024 * 1024,
  // Rollouts are append-only JSONL, so the reader resumes from a byte offset.
  append: (file) => file.endsWith(".jsonl"),
  roots: codexRoots,
  async files() {
    const found: string[] = [];
    for (const root of codexRoots())
      found.push(...(await walkFiles(root, (name) => name.endsWith(".jsonl"), 6)));
    return found.sort();
  },
  read: readCodexUsage,
};
