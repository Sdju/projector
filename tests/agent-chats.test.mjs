import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  archiveLiveChat,
  closeHistoryStore,
  listArchivedChats,
  openArchivedChat,
  readAgentHistory,
  removeArchivedChat,
  renameArchivedChat,
  writeAgentHistory,
} from "../server/modules/agent/index.ts";

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
});
