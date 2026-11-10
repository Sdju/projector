import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  archiveLiveChat,
  closeHistoryStore,
  forgetChat,
  listArchivedChats,
  openArchivedChat,
  readAgentHistory,
  readChatQueue,
  readRecentChats,
  removeArchivedChat,
  removeChatsWithSession,
  renameArchivedChat,
  writeAgentHistory,
} from "../modules/agent/index.ts";
import { historyDatabase } from "../modules/agent/history-store.ts";

const turn = (id, role, text) => ({ id, role, text, tools: [] });
let directory;
let previous;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "projector-chats-"));
  previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
});
afterAll(async () => {
  closeHistoryStore();
  process.env.XDG_DATA_HOME = previous;
  await rm(directory, { recursive: true, force: true });
});

describe("Projector agent chat history", () => {
  it("puts the live chat aside, lists it, brings it back and removes it", async () => {
    expect(await archiveLiveChat("p")).toBeUndefined();
    await writeAgentHistory("p", [
      turn("1", "user", "  первый\n вопрос  "),
      turn("2", "assistant", "ответ"),
    ]);
    const first = await archiveLiveChat("p");
    expect(await readAgentHistory("p")).toEqual([]);
    expect(listArchivedChats("p")).toMatchObject([
      { id: first, title: "первый вопрос", pinned: false },
    ]);
    expect(listArchivedChats("other")).toEqual([]);

    await writeAgentHistory("p", [turn("3", "user", "второй"), turn("4", "assistant", "ок")]);
    renameArchivedChat(first, { title: "Старый", pinned: true });
    const opened = await openArchivedChat("p", first);
    expect(opened.map((item) => item.id)).toEqual(["1", "2"]);
    expect((await readAgentHistory("p")).map((item) => item.id)).toEqual(["1", "2"]);
    const [second] = listArchivedChats("p");
    expect(second.title).toBe("второй");
    await expect(openArchivedChat("p", first)).rejects.toThrow();

    removeArchivedChat(second.id);
    expect(listArchivedChats("p")).toEqual([]);
  });

  it("keeps the usage of an answer, so the tooltip survives a reload", async () => {
    const usage = {
      input: 200,
      output: 200,
      cacheRead: 800,
      cacheWrite: 0,
      first: { input: 200, output: 0, cacheRead: 800, cacheWrite: 0 },
      cost: 0.0022,
    };
    await writeAgentHistory("u", [{ ...turn("1", "assistant", "ответ"), usage }]);
    expect((await readAgentHistory("u"))[0].usage).toEqual(usage);
  });

  it("keeps the messages waiting for the answer and clears them with a new chat", async () => {
    const queue = [
      {
        id: "q1",
        text: "подожди ответа",
        parts: [{ type: "text", text: "подожди ответа" }],
        form: { source: "<Form />", values: { next: "a" }, summary: "Дальше" },
        auto: "job-1",
        autoTitle: "Проверка",
      },
    ];
    await writeAgentHistory(
      "queue",
      [turn("1", "user", "вопрос")],
      { project: "queue-project", backend: "projector" },
      undefined,
      undefined,
      undefined,
      queue,
    );
    expect(readChatQueue("queue")).toEqual(queue);
    await archiveLiveChat("queue");
    expect(readChatQueue("queue")).toBeUndefined();
  });

  it("keeps when a message was written", async () => {
    await writeAgentHistory("t", [{ ...turn("1", "user", "вопрос"), at: 1760000000000 }]);
    expect((await readAgentHistory("t"))[0].at).toBe(1760000000000);
  });

  it("keeps the job a continuation belongs to and the name shown for it", async () => {
    const job = { auto: "aaaaaaaaaaaa", autoTitle: "Починить guard" };
    const injected = "[Projector] возможности";
    await writeAgentHistory("j", [
      { ...turn("1", "user", "задание завершилось"), ...job, injected },
    ]);
    expect((await readAgentHistory("j"))[0]).toMatchObject({ ...job, injected });
  });

  it("keeps the form a user answered, with the values that were sent", async () => {
    const form = {
      source: "<Form><Checks name=\"next\" :options=\"['a','b']\" /></Form>",
      values: { next: ["b"] },
      summary: "Продолжить",
    };
    await writeAgentHistory("f", [{ ...turn("1", "user", "Продолжить"), form }]);
    expect((await readAgentHistory("f"))[0].form).toEqual(form);
  });

  it("remembers the native session a chat continues, including rows written earlier", async () => {
    const index = { project: "sessions-project", backend: "opencode", title: "Чат" };
    const chat = "opencode:sessions-project:chat";
    const answer = {
      ...turn("2", "assistant", "ответ"),
      session: { backend: "opencode", id: "ses_one" },
    };
    await writeAgentHistory(chat, [turn("1", "user", "вопрос"), answer], index);
    expect(readRecentChats("sessions-project", "opencode")).toMatchObject([
      { chat, title: "Чат", session: "ses_one" },
    ]);

    // A row from before the index kept sessions gets it from the saved turns, once.
    historyDatabase().prepare("UPDATE chat_index SET session = NULL WHERE chat = ?").run(chat);
    expect(readRecentChats("sessions-project", "opencode")[0].session).toBe("ses_one");
    expect(
      historyDatabase().prepare("SELECT session FROM chat_index WHERE chat = ?").get(chat).session,
    ).toBe("ses_one");

    // A detached answer is a chat that no longer continues the session.
    await writeAgentHistory(
      chat,
      [turn("1", "user", "вопрос"), { ...answer, detached: true }],
      index,
    );
    expect(readRecentChats("sessions-project", "opencode")[0].session).toBeUndefined();
  });

  it("deleting a session forgets the chats that continued it", async () => {
    const project = "deleted-project";
    const backend = "opencode";
    const index = { project, backend };
    const chat = (name) => `${backend}:${project}:${name}`;
    const answer = (id, session) => ({
      ...turn(id, "assistant", "ответ"),
      session: { backend, id: session },
    });
    await writeAgentHistory(
      chat("first"),
      [turn("1", "user", "q"), answer("2", "ses_gone")],
      index,
    );
    await writeAgentHistory(
      chat("second"),
      [turn("3", "user", "q"), answer("4", "ses_gone")],
      index,
    );
    await writeAgentHistory(chat("keep"), [turn("5", "user", "q"), answer("6", "ses_gone")], index);
    await writeAgentHistory(
      chat("other"),
      [turn("7", "user", "q"), answer("8", "ses_other")],
      index,
    );

    const removed = removeChatsWithSession(project, backend, "ses_gone", chat("keep"));
    expect(removed.sort()).toEqual([chat("first"), chat("second")].sort());
    expect(
      readRecentChats(project, backend)
        .map((item) => item.chat)
        .sort(),
    ).toEqual([chat("keep"), chat("other")].sort());
    expect(await readAgentHistory(chat("first"))).toEqual([]);
    expect(await readAgentHistory(chat("keep")).then((turns) => turns.length)).toBe(2);
  });

  it("forgets a chat only in its own project", async () => {
    const project = "forget-project";
    const chat = `projector:${project}:tab`;
    await writeAgentHistory(chat, [turn("1", "user", "q"), turn("2", "assistant", "a")], {
      project,
      backend: "projector",
    });
    expect(forgetChat("other-project", chat)).toBe(false);
    expect(readRecentChats("forget-project").some((item) => item.chat === chat)).toBe(true);
    expect(forgetChat(project, chat)).toBe(true);
    expect(readRecentChats("forget-project").some((item) => item.chat === chat)).toBe(false);
    expect(await readAgentHistory(chat)).toEqual([]);
    expect(forgetChat(project, chat)).toBe(false);
  });
});
