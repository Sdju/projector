import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cursorSessionCookie } from "../src/session.ts";
import {
  CURSOR_USAGE_EVENTS_URL,
  cursorUsageEvent,
  cursorUsageEvents,
  cursorUsageJournalFile,
  cursorUsageLog,
  readCursorUsageJournal,
  resetCursorUsageLogSync,
} from "../src/usage-log.ts";

const at = 1_775_418_973_898;

const row = {
  timestamp: String(at),
  model: "grok-4.7",
  kind: "USAGE_EVENT_KIND_INCLUDED_IN_ULTRA",
  isHeadless: true,
  tokenUsage: {
    inputTokens: 120,
    outputTokens: 40,
    cacheReadTokens: 800,
    cacheWriteTokens: 15,
    totalCents: 12.5,
  },
  chargedCents: 12.5,
};

function jwt(sub = "user_01TEST") {
  const payload = Buffer.from(JSON.stringify({ sub })).toString("base64url");
  return `eyJhbGciOiJub25lIn0.${payload}.x`;
}

test("dashboard rows become one event with cache tokens and recorded cents", () => {
  expect(cursorUsageEvent(row)).toMatchObject({
    session: "headless",
    event: `${at}:grok-4.7:120:40:800:15`,
    at,
    model: "grok-4.7",
    tokens: { input: 120, output: 40, cacheRead: 800, cacheWrite: 15 },
    cost: 0.125,
    costSource: "recorded",
  });
  expect(
    cursorUsageEvent({
      ...row,
      isHeadless: false,
      chargedCents: 0,
      tokenUsage: { ...row.tokenUsage, cacheReadTokens: 0, cacheWriteTokens: 0 },
    }),
  ).toMatchObject({
    session: "ide",
    tokens: { input: 120, output: 40, cacheRead: 0, cacheWrite: 0 },
    costSource: "none",
  });
  expect(cursorUsageEvent({ ...row, tokenUsage: { inputTokens: 0, outputTokens: 0 } })).toBe(null);
  expect(cursorUsageEvent({ ...row, timestamp: "invalid" })).toBe(null);
  expect(cursorUsageEvents({ usageEventsDisplay: [row, { model: "x" }] })).toHaveLength(1);
});

test("the WorkOS cookie uses the JWT subject, not a Bearer header", () => {
  expect(cursorSessionCookie(jwt())).toBe(`WorkosCursorSessionToken=user_01TEST::${jwt()}`);
});

let directory;
let previousFetch;
let previousEnv;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "projector-cursor-usage-log-"));
  previousFetch = globalThis.fetch;
  previousEnv = {
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    CURSOR_AUTH_CONTENT: process.env.CURSOR_AUTH_CONTENT,
    HOME: process.env.HOME,
  };
  process.env.XDG_CACHE_HOME = directory;
  process.env.XDG_CONFIG_HOME = join(directory, "config");
  process.env.HOME = join(directory, "home");
  process.env.CURSOR_AUTH_CONTENT = JSON.stringify({ accessToken: jwt() });
  resetCursorUsageLogSync();
});

afterEach(async () => {
  globalThis.fetch = previousFetch;
  resetCursorUsageLogSync();
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await rm(directory, { recursive: true, force: true });
});

function mockDashboard(pages, probe = { success: true, is_eu: true }) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    if (typeof url !== "string") throw new Error("unexpected request");
    calls.push({ url, options });
    if (url === "https://ipwho.is/") return Response.json(probe);
    if (url === CURSOR_USAGE_EVENTS_URL) {
      const body = JSON.parse(options.body);
      const page = body.page ?? 1;
      return Response.json(pages[page - 1] ?? { usageEventsDisplay: [], totalUsageEventsCount: 0 });
    }
    throw new Error(`unexpected url ${url}`);
  };
  return calls;
}

test("files() writes the dashboard journal and read() resumes from the byte cursor", async () => {
  const calls = mockDashboard([{ usageEventsDisplay: [row], totalUsageEventsCount: 1 }]);
  expect(await cursorUsageLog.files()).toEqual([cursorUsageJournalFile()]);
  const first = await readCursorUsageJournal(cursorUsageJournalFile());
  expect(first.events).toMatchObject([
    { session: "headless", model: "grok-4.7", tokens: { input: 120, output: 40 } },
  ]);
  const dashboard = calls.find((call) => call.url === CURSOR_USAGE_EVENTS_URL);
  expect(dashboard.options.headers.Origin).toBe("https://cursor.com");
  expect(dashboard.options.headers.Cookie).toContain("user_01TEST::");
  expect(dashboard.options.redirect).toBe("error");
  const sent = JSON.parse(dashboard.options.body);
  expect(typeof sent.startDate).toBe("string");
  expect(typeof sent.endDate).toBe("string");
  expect(sent.page).toBe(1);

  resetCursorUsageLogSync();
  await cursorUsageLog.files();
  const lines = (await readFile(cursorUsageJournalFile(), "utf8")).trim().split("\n");
  expect(lines).toHaveLength(1);
  const second = await readCursorUsageJournal(cursorUsageJournalFile(), first.state);
  expect(second.events).toEqual([]);
});

test("a second dashboard event is appended once", async () => {
  mockDashboard([{ usageEventsDisplay: [row], totalUsageEventsCount: 1 }]);
  await cursorUsageLog.files();
  resetCursorUsageLogSync();
  const later = {
    ...row,
    timestamp: String(at + 60_000),
    tokenUsage: { ...row.tokenUsage, outputTokens: 9 },
    chargedCents: 0,
  };
  mockDashboard([{ usageEventsDisplay: [row, later], totalUsageEventsCount: 2 }]);
  await cursorUsageLog.files();
  const read = await readCursorUsageJournal(cursorUsageJournalFile());
  expect(read.events).toHaveLength(2);
  expect(read.events[1]).toMatchObject({
    tokens: { output: 9 },
    costSource: "none",
  });
});

test("missing auth and a failed probe never send the dashboard request", async () => {
  delete process.env.CURSOR_AUTH_CONTENT;
  let cursorCalls = 0;
  globalThis.fetch = async (url) => {
    if (url === CURSOR_USAGE_EVENTS_URL) cursorCalls++;
    throw new Error("must not fetch");
  };
  expect(await cursorUsageLog.files()).toEqual([]);
  expect(cursorCalls).toBe(0);

  process.env.CURSOR_AUTH_CONTENT = JSON.stringify({ accessToken: jwt() });
  resetCursorUsageLogSync();
  mockDashboard([{ usageEventsDisplay: [row] }], { success: true, is_eu: false });
  await expect(cursorUsageLog.files()).rejects.toThrow(/сетевой контекст/);
});

test("auth errors do not expose upstream bodies", async () => {
  globalThis.fetch = async (url) => {
    if (url === "https://ipwho.is/") return Response.json({ success: true, is_eu: true });
    return new Response("SECRET upstream details", { status: 401 });
  };
  await expect(cursorUsageLog.files()).rejects.toThrow(/истекла/);
  await expect(cursorUsageLog.files()).rejects.toSatisfy(
    (error) => !error.message.includes("SECRET"),
  );
});
