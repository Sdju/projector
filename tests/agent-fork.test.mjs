import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reactive } from "vue";
import { forkAt } from "../src/modules/agent/model/branches.ts";
import { forkChat } from "../src/modules/agent/model/chat-fork.ts";
import { chatKeyOf } from "../src/modules/agent/model/chat-key.ts";
import { takeDraft } from "../src/modules/agent/model/drafts.ts";
import { registerBuiltinClientAgents } from "../src/app/agents.ts";
import {
  archiveLiveChat,
  closeHistoryStore,
  openArchivedChat,
  readAgentHistory,
  readRecentChats,
  writeAgentHistory,
} from "../server/modules/agent/index.ts";

const turn = (id, role, extra = {}) => ({ id, role, text: id, tools: [], ...extra });
registerBuiltinClientAgents();
const ids = (turns) => turns.map((item) => item.id).join(",");
let directory;
let previous;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "projector-forks-"));
  previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
});
afterAll(async () => {
  closeHistoryStore();
  process.env.XDG_DATA_HOME = previous;
  await rm(directory, { recursive: true, force: true });
});

test("fork before a question keeps the earlier turns and returns the question as a draft", () => {
  const chips = [{ type: "file", path: "src/app.ts" }];
  const turns = [
    turn("u1", "user"),
    turn("a1", "assistant"),
    turn("u2", "user", { text: "второй", content: chips }),
    turn("a2", "assistant"),
  ];
  const slice = forkAt(turns, "u2", "before");
  expect(ids(slice.turns)).toBe("u1,a1");
  expect(slice.draft).toEqual({ text: "второй", parts: chips });
  // The source chat is untouched, and the copy shares nothing with it.
  expect(ids(turns)).toBe("u1,a1,u2,a2");
  slice.turns[0].text = "changed";
  expect(turns[0].text).toBe("u1");
  expect(forkAt(turns, "u1", "before")).toEqual({ turns: [], draft: { text: "u1", parts: [] } });
});

test("fork after an answer copies it, and after a question copies the answer too", () => {
  const turns = [
    turn("u1", "user"),
    turn("a1", "assistant"),
    turn("u2", "user"),
    turn("a2", "assistant"),
  ];
  expect(ids(forkAt(turns, "a1", "after").turns)).toBe("u1,a1");
  expect(ids(forkAt(turns, "u2", "after").turns)).toBe("u1,a1,u2,a2");
  expect(forkAt(turns, "u2", "after").draft).toBeUndefined();
});

test("a fork does not start before an answer or from a question still waiting", () => {
  const turns = [turn("u1", "user"), turn("a1", "assistant"), turn("u2", "user")];
  expect(forkAt(turns, "a1", "before")).toBeUndefined();
  expect(forkAt(turns, "u2", "after")).toBeUndefined();
  expect(forkAt(turns, "missing", "before")).toBeUndefined();
});

test("a fork drops live runs and the versions of the original, and stops running tasks", () => {
  const turns = [
    turn("u1", "user", {
      variants: [[turn("u0", "user")]],
      slot: 1,
    }),
    turn("a1", "assistant", {
      run: "run-1",
      tasks: [{ id: "t1", kind: "subagent", status: "running" }],
    }),
  ];
  const copy = forkAt(turns, "a1", "after").turns;
  expect(copy[0].variants).toBeUndefined();
  expect(copy[0].slot).toBeUndefined();
  expect(copy[1].run).toBeUndefined();
  expect(copy[1].tasks[0].status).toBe("stopped");
  expect(copy[1].tasks[0].summary).toBeTruthy();
  expect(turns[1].tasks[0].status).toBe("running");
});

test("a fork of the reactive chat state is a plain copy", () => {
  const turns = reactive([turn("u1", "user"), turn("a1", "assistant")]);
  const slice = forkAt(turns, "a1", "after");
  expect(slice.turns.map((item) => item.id)).toEqual(["u1", "a1"]);
  slice.turns[0].text = "changed";
  expect(turns[0].text).toBe("u1");
});

test("forking writes the copy under a new chat key and parks its draft", async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: typeof url === "string" ? url : "", body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ turns: [] }) };
  };
  try {
    const turns = [turn("u1", "user"), turn("a1", "assistant"), turn("u2", "user")];
    const result = await forkChat({
      backend: "projector",
      projectId: "p",
      turns,
      turnId: "u2",
      mode: "before",
    });
    expect(result.chat).toBe(chatKeyOf("projector", "p", result.chatId));
    expect(result.chat.startsWith("projector:p:")).toBe(true);
    expect(result.title).toBe("Ветка · u2");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`/api/agent/history/${encodeURIComponent(result.chat)}`);
    expect(calls[0].body.projectId).toBe("p");
    expect(calls[0].body.backend).toBe("projector");
    expect(calls[0].body.title).toBe("Ветка · u2");
    expect(calls[0].body.turns.map((item) => item.id)).toEqual(["u1", "a1"]);
    expect(takeDraft(result.chat)).toEqual({ text: "u2", parts: [] });
    // The draft is handed over once.
    expect(takeDraft(result.chat)).toBeUndefined();
  } finally {
    globalThis.fetch = original;
  }
});

test("a fork of an agent without native branches detaches the copied session", async () => {
  const original = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ turns: [] }) };
  };
  try {
    const turns = [
      turn("u1", "user"),
      turn("a1", "assistant", { session: { id: "s" }, tail: "tail-1" }),
    ];
    const untailed = [turn("u1", "user"), turn("a1", "assistant", { session: { id: "s" } })];
    await forkChat({ backend: "codex", projectId: "p", turns, turnId: "a1", mode: "after" });
    await forkChat({
      backend: "claude-code",
      projectId: "p",
      turns,
      turnId: "a1",
      mode: "after",
      branchSession: true,
    });
    await forkChat({
      backend: "claude-code",
      projectId: "p",
      turns: untailed,
      turnId: "a1",
      mode: "after",
      branchSession: true,
    });
    await forkChat({ backend: "projector", projectId: "p", turns, turnId: "a1", mode: "after" });
    // Codex cannot branch: it starts a new native session and replays the copy.
    expect(bodies[0].turns.at(-1).detached).toBe(true);
    // Claude Code branches natively at `tail`, and detaches when `tail` is missing; Projector has no session.
    expect(bodies[1].turns.at(-1).detached).toBeUndefined();
    expect(bodies[2].turns.at(-1).detached).toBe(true);
    expect(bodies[3].turns.at(-1).detached).toBeUndefined();
  } finally {
    globalThis.fetch = original;
  }
});

test("a fork without a project is refused before anything is saved", async () => {
  await expect(
    forkChat({ backend: "projector", projectId: "", turns: [], turnId: "u1", mode: "before" }),
  ).rejects.toThrow("только в проекте");
});

test("the project's chats are listed and a closed fork stays findable", async () => {
  await writeAgentHistory(
    "projector:p:one",
    [turn("1", "user", { text: "Первый вопрос" }), turn("2", "assistant", { text: "ответ" })],
    { project: "p", backend: "projector" },
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  await writeAgentHistory(
    "claude-code:p:two",
    [turn("1", "user", { text: "Второй вопрос" }), turn("2", "assistant", { text: "ответ" })],
    { project: "p", backend: "claude-code" },
  );
  expect(readRecentChats("p").map((item) => item.chat)).toEqual([
    "claude-code:p:two",
    "projector:p:one",
  ]);
  expect(readRecentChats("p", "projector").map((item) => item.chat)).toEqual(["projector:p:one"]);
  expect(readRecentChats("other")).toEqual([]);
  expect(readRecentChats("p")).toMatchObject([
    { title: "Второй вопрос", backend: "claude-code" },
    { title: "Первый вопрос", backend: "projector" },
  ]);

  // Archiving empties the live chat but keeps it: the copy is listed as an archive, not as a chat.
  const archived = await archiveLiveChat("projector:p:one");
  expect(readRecentChats("p", "projector")).toEqual([]);
  expect(await readAgentHistory("projector:p:one")).toEqual([]);
  const restored = await openArchivedChat("projector:p:one", archived);
  expect(restored.map((item) => item.id)).toEqual(["1", "2"]);
  expect(readRecentChats("p", "projector").map((item) => item.chat)).toEqual(["projector:p:one"]);
});

test("an emptied chat leaves the list of recent chats", async () => {
  await writeAgentHistory("projector:p:fresh", [turn("1", "user", { text: "живой" })], {
    project: "p",
    backend: "projector",
  });
  expect(readRecentChats("p", "projector").some((item) => item.chat === "projector:p:fresh")).toBe(
    true,
  );
  await writeAgentHistory("projector:p:fresh", [], { project: "p", backend: "projector" });
  expect(readRecentChats("p", "projector").some((item) => item.chat === "projector:p:fresh")).toBe(
    false,
  );
});

test("a fork keeps its branch title in the project's list across later turns", async () => {
  await writeAgentHistory(
    "projector:p:branch",
    [turn("1", "user", { text: "Первый вопрос" }), turn("2", "assistant", { text: "ответ" })],
    { project: "p", backend: "projector", title: "Ветка · Второй вопрос" },
  );
  // Later saves carry only project and backend; the branch title must not fall back to turn 1.
  await writeAgentHistory(
    "projector:p:branch",
    [
      turn("1", "user", { text: "Первый вопрос" }),
      turn("2", "assistant", { text: "ответ" }),
      turn("3", "user", { text: "Второй вопрос" }),
    ],
    { project: "p", backend: "projector" },
  );
  expect(
    readRecentChats("p", "projector").find((item) => item.chat === "projector:p:branch")?.title,
  ).toBe("Ветка · Второй вопрос");
});
