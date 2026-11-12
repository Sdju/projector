import { createReadStream, existsSync } from "node:fs";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { UsageLogEvent, UsageLogRead, UsageLogReader, UsageTokens } from "./api.ts";
import {
  AUTH_UNAVAILABLE,
  assertEuNetworkContext,
  cursorCacheHome,
  cursorConfigHome,
  cursorHome,
  cursorPostJson,
  cursorSessionCookie,
  readCursorAccessToken,
} from "./session.ts";

export const CURSOR_USAGE_EVENTS_URL = "https://cursor.com/api/dashboard/get-filtered-usage-events";

const PAGE_SIZE = 1000;
const MAX_PAGES = 40;
const SYNC_MS = 60_000;
const YEAR_MS = 366 * 86400000;
const TIMEOUT_MS = 15_000;

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function timestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0)
    return value > 1e12 ? value : value * 1000;
  if (typeof value === "string" && value.trim()) {
    const ms = Number(value);
    if (Number.isFinite(ms) && ms > 0) return ms > 1e12 ? ms : ms * 1000;
  }
  return null;
}

function cents(value: unknown): number | null {
  const amount = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return null;
  return amount / 100;
}

function tokensOf(usage: Record<string, unknown>): UsageTokens {
  return {
    input: count(usage.inputTokens ?? usage.input_tokens),
    output: count(usage.outputTokens ?? usage.output_tokens),
    cacheRead: count(usage.cacheReadTokens ?? usage.cache_read_tokens),
    cacheWrite: count(usage.cacheWriteTokens ?? usage.cache_write_tokens),
  };
}

const empty = (tokens: UsageTokens) =>
  tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite === 0;

/**
 * One row of Cursor's dashboard usage log. Local transcripts and `store.db` do not carry
 * per-request tokens, so this is the journal analytics can actually count.
 */
export function cursorUsageEvent(value: unknown): UsageLogEvent | null {
  const row = record(value);
  if (!row) return null;
  const usage = record(row.tokenUsage) ?? record(row.token_usage);
  if (!usage) return null;
  const tokens = tokensOf(usage);
  if (empty(tokens)) return null;
  const at = timestamp(row.timestamp ?? row.at);
  if (at === null) return null;
  const model = text(row.model);
  const conversation = text(row.conversationId ?? row.conversation_id ?? row.requestId);
  const session = conversation || (row.isHeadless === true ? "headless" : "ide");
  const cwd = text(row.cwd ?? row.workspacePath ?? row.workspace);
  const charged = cents(row.chargedCents ?? row.charged_cents);
  return {
    session,
    event:
      text(row.id) ||
      `${at}:${model}:${tokens.input}:${tokens.output}:${tokens.cacheRead}:${tokens.cacheWrite}`,
    at,
    ...(model ? { model } : {}),
    ...(cwd ? { cwd } : {}),
    tokens,
    ...(charged !== null ? { cost: charged } : {}),
    costSource: charged !== null ? "recorded" : "none",
  };
}

/** `usageEventsDisplay` of one dashboard page; unknown shapes are empty, not zero tokens. */
export function cursorUsageEvents(payload: unknown): UsageLogEvent[] {
  const body = record(payload);
  const rows = body?.usageEventsDisplay ?? body?.usageEvents;
  if (!Array.isArray(rows)) return [];
  const events: UsageLogEvent[] = [];
  for (const row of rows) {
    const event = cursorUsageEvent(row);
    if (event) events.push(event);
  }
  return events;
}

export function cursorUsageJournalFile(): string {
  return join(cursorCacheHome(), "projector", "cursor-usage.jsonl");
}

let lastSync = 0;

/** Test hook: the next `files()` may talk to Cursor again. */
export function resetCursorUsageLogSync(): void {
  lastSync = 0;
}

async function lastCursor(file: string, take = 200): Promise<{ at: number; ids: Set<string> }> {
  const body = await readFile(file, "utf8");
  const ids = new Set<string>();
  let at = 0;
  const lines = body.split("\n");
  for (const line of lines.slice(Math.max(0, lines.length - take))) {
    const event = eventFromLine(line);
    if (!event) continue;
    ids.add(event.event);
    at = Math.max(at, event.at);
  }
  return { at, ids };
}

/**
 * Pages the dashboard usage log. `startDate`/`endDate` are epoch milliseconds as strings: ISO
 * dates make the endpoint answer HTTP 500.
 */
export async function fetchCursorUsageEvents(
  since: number,
  now: number,
  timeoutMs = TIMEOUT_MS,
): Promise<UsageLogEvent[]> {
  const token = await readCursorAccessToken();
  await assertEuNetworkContext(timeoutMs);
  const cookie = cursorSessionCookie(token);
  const events: UsageLogEvent[] = [];
  let page = 1;
  let total: number | null = null;
  let seen = 0;
  while (page <= MAX_PAGES) {
    const payload = await cursorPostJson(
      CURSOR_USAGE_EVENTS_URL,
      JSON.stringify({
        startDate: String(Math.floor(since)),
        endDate: String(Math.floor(now)),
        page,
        pageSize: PAGE_SIZE,
      }),
      {
        Cookie: cookie,
        Origin: "https://cursor.com",
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      timeoutMs,
      "Не удалось получить журнал расхода Cursor",
    );
    const body = record(payload);
    if (!body) throw new Error("Некорректный ответ Cursor");
    const rows = body.usageEventsDisplay ?? body.usageEvents;
    const rawCount = Array.isArray(rows) ? rows.length : 0;
    events.push(...cursorUsageEvents(payload));
    const countValue = body.totalUsageEventsCount;
    if (typeof countValue === "number" && Number.isFinite(countValue) && countValue >= 0)
      total = countValue;
    seen += rawCount;
    if (rawCount < PAGE_SIZE) break;
    if (total !== null && seen >= total) break;
    page += 1;
  }
  events.sort((a, b) => a.at - b.at || a.event.localeCompare(b.event));
  return events;
}

async function syncCursorUsageJournal(now = Date.now()): Promise<string | null> {
  const file = cursorUsageJournalFile();
  const exists = existsSync(file);
  if (exists && now - lastSync < SYNC_MS) return file;
  let stored = { at: 0, ids: new Set<string>() };
  try {
    if (exists) stored = await lastCursor(file);
  } catch {
    stored = { at: 0, ids: new Set<string>() };
  }
  const start = stored.at > 0 ? stored.at : now - YEAR_MS;
  let fetched: UsageLogEvent[];
  try {
    fetched = await fetchCursorUsageEvents(start, now);
  } catch (error) {
    lastSync = now;
    if (exists) return file;
    if (error instanceof Error && error.message === AUTH_UNAVAILABLE) return null;
    throw error;
  }
  const fresh = fetched.filter((event) => !stored.ids.has(event.event));
  lastSync = now;
  if (!fresh.length) return exists ? file : null;
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, fresh.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
  return file;
}

function eventFromLine(raw: string): UsageLogEvent | null {
  if (!raw.trim()) return null;
  try {
    const value = record(JSON.parse(raw) as unknown);
    if (!value) return null;
    const tokens = record(value.tokens);
    if (!tokens || typeof value.session !== "string" || typeof value.event !== "string")
      return null;
    const at = timestamp(value.at);
    if (at === null) return null;
    const parsed: UsageTokens = {
      input: count(tokens.input),
      output: count(tokens.output),
      cacheRead: count(tokens.cacheRead),
      cacheWrite: count(tokens.cacheWrite),
    };
    if (empty(parsed)) return null;
    const model = text(value.model);
    const cwd = text(value.cwd);
    const cost = typeof value.cost === "number" && Number.isFinite(value.cost) ? value.cost : null;
    return {
      session: value.session,
      event: value.event,
      at,
      ...(model ? { model } : {}),
      ...(cwd ? { cwd } : {}),
      tokens: parsed,
      ...(cost !== null ? { cost } : {}),
      costSource: value.costSource === "recorded" && cost !== null ? "recorded" : "none",
    };
  } catch {
    return null;
  }
}

/**
 * Streams complete JSONL lines from the last cursor. The dashboard copy is append-only, so an
 * unchanged file is not parsed again.
 */
export async function readCursorUsageJournal(file: string, state?: string): Promise<UsageLogRead> {
  const size = (await stat(file)).size;
  const offset = state && Number.isFinite(Number(state)) ? Number(state) : 0;
  const nextLine = offset >= 0 && offset <= size ? offset : 0;
  const events: UsageLogEvent[] = [];
  let cursor = nextLine;
  let buffer = "";
  if (size === 0) return { events, state: "0" };
  for await (const chunk of createReadStream(file, { start: nextLine, encoding: "utf8" })) {
    buffer += chunk;
    let end = buffer.indexOf("\n");
    while (end >= 0) {
      const raw = buffer.slice(0, end);
      const bytes = Buffer.byteLength(raw) + 1;
      buffer = buffer.slice(end + 1);
      const event = eventFromLine(raw.endsWith("\r") ? raw.slice(0, -1) : raw);
      if (event) events.push(event);
      cursor += bytes;
      end = buffer.indexOf("\n");
    }
  }
  return { events, state: String(cursor) };
}

export const cursorUsageLog: UsageLogReader = {
  agent: "cursor",
  label: "Cursor",
  append: (file) => file.endsWith(".jsonl"),
  roots: () => [
    cursorHome(),
    join(cursorConfigHome(), "cursor"),
    join(cursorConfigHome(), "Cursor"),
    dirname(cursorUsageJournalFile()),
  ],
  async files() {
    const file = await syncCursorUsageJournal();
    return file ? [file] : [];
  },
  read: readCursorUsageJournal,
};
