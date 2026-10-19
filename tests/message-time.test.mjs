import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test, vi } from "vite-plus/test";
import { createAcpReplayCollector } from "../server/modules/agents/acp/acp-events.ts";
import { uuidV7Time } from "../server/modules/agents/acp/acp-dialect.ts";
import { createCodexDialect } from "../server/modules/agents/codex/dialect.ts";
import {
  createOpencodeDialect,
  opencodeIdTime,
} from "../server/modules/agents/opencode/dialect.ts";

const transcript = vi.hoisted(() => []);
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  getSessionMessages: async () => transcript,
}));
vi.resetModules();
const { claudeLoadSession } =
  await import("../server/modules/agents/claude-code/claude-code-sessions.ts");

test("a UUIDv7 carries its time, any other id does not", () => {
  expect(uuidV7Time("01a13e17-a880-7962-b3f2-6e1a5433545a")).toBe(
    Date.parse("2026-10-15T05:45:00.288Z"),
  );
  expect(uuidV7Time("msg_05aae81d26237873016ad0685dba148191b621e0ac65b3efad")).toBeUndefined();
  expect(uuidV7Time("a4795ed1-86f5-4f6d-9dfe-031339b691f3")).toBeUndefined();
  expect(uuidV7Time(undefined)).toBeUndefined();
});

test("an OpenCode id restores the full time from its low 36 bits", () => {
  const now = Date.parse("2026-10-19T14:00:00Z");
  expect(new Date(opencodeIdTime("msg_1280e32ea001Q10kCMeGC59Y85", now)).toISOString()).toBe(
    "2026-10-10T23:03:01.610Z",
  );
  // The same id read a year later still lands on the nearest matching moment.
  const later = Date.parse("2027-10-19T14:00:00Z");
  expect(new Date(opencodeIdTime("msg_1280e32ea001Q10kCMeGC59Y85", later)).toISOString()).toBe(
    "2026-10-10T23:03:01.610Z",
  );
  expect(opencodeIdTime("ses_ed7f3432fffe")).toBeUndefined();
});

const chunk = (kind, messageId, text) => ({
  sessionUpdate: kind,
  ...(messageId ? { messageId } : {}),
  content: { type: "text", text },
});

test("Codex replay stamps what it can: user messages by UUIDv7, answers stay unstamped", () => {
  const collector = createAcpReplayCollector("codex", "s", createCodexDialect());
  collector.handleUpdate(
    chunk("user_message_chunk", "01a13e17-a880-7962-b3f2-6e1a5433545a", "вопрос"),
  );
  collector.handleUpdate(chunk("agent_message_chunk", "msg_05aae81d26237873016ad0685dba", "ответ"));
  const [question, answer] = collector.turns;
  expect(question.at).toBe(Date.parse("2026-10-15T05:45:00.288Z"));
  expect(answer.at).toBeUndefined();
});

test("OpenCode replay stamps both sides and keeps the time of the first chunk", () => {
  const collector = createAcpReplayCollector("opencode", "s", createOpencodeDialect());
  collector.handleUpdate(chunk("agent_message_chunk", "msg_1280e32ea001Q10kCMeGC59Y85", "a"));
  collector.handleUpdate(chunk("agent_message_chunk", "msg_1280ee92e001Zee0YV29KKkrdy", "b"));
  const [answer] = collector.turns;
  expect(new Date(answer.at).toISOString()).toBe("2026-10-10T23:03:01.610Z");
});

const home = mkdtempSync(join(tmpdir(), "claude-times-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

test("a reopened Claude Code chat takes message times from the stored transcript", async () => {
  const cwd = "/work/some.project";
  const folder = join(home, "projects", "-work-some-project");
  mkdirSync(folder, { recursive: true });
  const line = (uuid, timestamp) => JSON.stringify({ uuid, timestamp });
  writeFileSync(
    join(folder, "s1.jsonl"),
    [
      line("u1", "2026-10-19T13:43:48.109Z"),
      line("a1", "2026-10-19T13:44:10.000Z"),
      '{"uuid":"torn","timestamp":"2026',
    ].join("\n"),
  );
  vi.stubEnv("CLAUDE_CONFIG_DIR", home);
  transcript.length = 0;
  transcript.push(
    { type: "user", uuid: "u1", message: { content: "привет" }, parent_tool_use_id: null },
    {
      type: "assistant",
      uuid: "a1",
      message: { content: [{ type: "text", text: "здравствуйте" }] },
      parent_tool_use_id: null,
    },
  );
  const turns = await claudeLoadSession(cwd, "s1");
  expect(turns.map((turn) => new Date(turn.at).toISOString())).toStrictEqual([
    "2026-10-19T13:43:48.109Z",
    "2026-10-19T13:44:10.000Z",
  ]);
  // A session without a stored transcript still opens, just without times.
  transcript[0].uuid = "unknown";
  const [first] = await claudeLoadSession(cwd, "missing");
  expect(first.at).toBeUndefined();
  vi.unstubAllEnvs();
});
