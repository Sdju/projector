import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vite-plus/test";

// A continuation writes the recent-runs list and, for the built-in agent, reads the chat history:
// both live in the data directory, so it points at a temporary one for the whole file.
const root = await mkdtemp(join(tmpdir(), "projector-chat-resume-"));
const work = join(root, "work");
process.env.XDG_DATA_HOME = join(root, "data");
await mkdir(join(root, "data", "projector"), { recursive: true });
await mkdir(work, { recursive: true });

const { dueResume, sweepChatResumes } = await import("../modules/agent/chat-resume.ts");
const { registerAgentBackend } = await import("../modules/agent/registry.ts");
const { writeAgentHistory } = await import("../modules/agent/history.ts");
const { listRecentRuns, recordRecentRun } = await import("../modules/agent/recent-runs.ts");

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const now = 1_000_000;
const planned = (overrides = {}) => ({
  chat: "chat-1",
  projectId: "project-1",
  status: "error",
  failure: { class: "usage_limit", resetAt: now - 60_000 },
  resume: { at: now - 30_000, auto: true },
  ...overrides,
});

test("dueResume accepts a plan after the grace period and only for a recent usage limit", () => {
  expect(dueResume(planned(), now)).toBe(true);
  // The page of an open chat gets its own timer first.
  expect(dueResume(planned(), now - 1)).toBe(false);
  expect(dueResume(planned({ resume: { at: now - 30_000, auto: false } }), now)).toBe(false);
  expect(
    dueResume(planned({ failure: { class: "provider_error", resetAt: now - 60_000 } }), now),
  ).toBe(false);
  expect(dueResume(planned({ status: "done" }), now)).toBe(false);
  expect(dueResume(planned(), now + 24 * 60 * 60 * 1000)).toBe(false);
  expect(dueResume(planned({ chat: "" }), now)).toBe(false);
});

test("a due chat is continued once in the background and its result replaces the failure", async () => {
  let seen;
  registerAgentBackend({
    id: "fake-chat-resume",
    label: "Fake Chat Resume",
    async run(options) {
      seen = options;
      options.emit("session", { id: "session-new", backend: "fake-chat-resume" });
      options.emit("text", { text: "Продолжаю." });
      options.emit("done", { text: "Продолжаю." });
    },
  });

  const chat = "fake-chat-resume:project-1:resume-1";
  await writeAgentHistory(
    chat,
    [
      { id: "turn-1", role: "user", text: "Сделай это", tools: [] },
      {
        id: "turn-2",
        role: "assistant",
        text: "Не успел: лимит.",
        tools: [
          {
            id: "tool-1",
            name: "read",
            status: "error",
            detail: "quota",
            input: '{"path":"a.txt"}',
          },
        ],
      },
    ],
    { project: "project-1", backend: "fake-chat-resume" },
  );
  await recordRecentRun({
    id: "run-old",
    backend: "fake-chat-resume",
    projectId: "project-1",
    chat,
    topic: "Сделай это",
    status: "error",
    error: "Достигнут лимит",
    failure: {
      class: "usage_limit",
      message: "Достигнут лимит",
      code: "http_429",
      retryable: true,
      resetAt: Date.now() - 60_000,
    },
    resume: { at: Date.now() - 30_000, auto: true },
    session: "session-old",
    cwd: work,
    startedAt: Date.now() - 120_000,
    endedAt: Date.now() - 90_000,
  });

  await sweepChatResumes();

  const deadline = Date.now() + 8000;
  let item;
  while (Date.now() < deadline) {
    item = (await listRecentRuns()).find((entry) => entry.chat === chat);
    if (item?.status === "done") break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  expect(seen).toMatchObject({
    message: "продолжай",
    sessionId: "session-old",
    cwd: work,
    chat,
    projectId: "project-1",
    approvals: true,
    // An external agent continues its native session instead of the saved transcript.
    history: [],
  });
  expect(item).toMatchObject({
    status: "done",
    resultPreview: "Продолжаю.",
    session: "session-new",
    cwd: work,
  });
  expect(item?.resume).toBeUndefined();
  expect(item?.failure).toBeUndefined();
});
