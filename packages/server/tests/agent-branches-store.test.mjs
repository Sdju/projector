import { expect, test } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAgentHistory, writeAgentHistory } from "../modules/agent/index.ts";

const turn = (id, role, text = id) => ({ id, role, text, tools: [] });

test("saved history keeps versions of a conversation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "projector-branches-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const head = {
      ...turn("u2", "user"),
      slot: 1,
      variants: [[turn("u1", "user"), { ...turn("a1", "assistant"), tail: "t", detached: true }]],
    };
    await writeAgentHistory("branches", [head, turn("a2", "assistant")]);
    const saved = await readAgentHistory("branches");
    expect(saved[0].variants?.[0]?.[1]).toMatchObject({ tail: "t", detached: true });
    expect(saved[0].slot).toBe(1);
  } finally {
    (await import("../modules/agent/index.ts")).closeHistoryStore();
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("history store keeps a forked chat as a tree and rewrites only what changed", async () => {
  const { closeHistoryStore } = await import("../modules/agent/index.ts");
  const { loadHistory, saveHistory, historyRevision } =
    await import("../modules/agent/history-store.ts");
  const dir = await mkdtemp(join(tmpdir(), "projector-branches-db-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    // u1 a1 | fork at u2 (2 versions, second shown) | inside shown version a fork at u4 (3 versions)
    const inner = {
      ...turn("u4c", "user"),
      slot: 0,
      variants: [[turn("u4a", "user"), turn("a4a", "assistant")], [turn("u4b", "user")]],
    };
    const outer = {
      ...turn("u2b", "user"),
      slot: 0,
      variants: [[turn("u2a", "user"), turn("a2a", "assistant"), turn("u3a", "user")]],
    };
    const chat = [
      turn("u1", "user"),
      turn("a1", "assistant"),
      outer,
      turn("a2b", "assistant"),
      inner,
      turn("a4c", "assistant"),
    ];
    saveHistory("tree", structuredClone(chat));
    expect(loadHistory("tree")).toStrictEqual(chat);
    expect(historyRevision("tree")).toBe(1);

    // The shown version switches and the chat grows: the same tree comes back.
    const switched = structuredClone(chat);
    switched[2].slot = 1;
    switched[4].slot = 2;
    saveHistory("tree", structuredClone(switched));
    expect(loadHistory("tree")).toStrictEqual(switched);

    // Removing a whole version removes its rows.
    const pruned = structuredClone(chat);
    delete pruned[2].variants;
    delete pruned[2].slot;
    saveHistory("tree", structuredClone(pruned));
    expect(loadHistory("tree")).toStrictEqual(pruned);
    expect(loadHistory("missing")).toBeUndefined();
  } finally {
    closeHistoryStore();
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("a chat saved as a JSON file by an earlier version moves into the database", async () => {
  const { closeHistoryStore } = await import("../modules/agent/index.ts");
  const { legacyHistoryPath } = await import("../modules/agent/history-store.ts");
  const { mkdir, writeFile, access } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "projector-branches-legacy-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  try {
    const old = [
      { ...turn("u2", "user"), slot: 0, variants: [[turn("u1", "user")]] },
      {
        ...turn("a2", "assistant"),
        parts: [{ type: "note", text: "live" }],
        worktree: { id: "w", branch: "b" },
      },
    ];
    const file = legacyHistoryPath("legacy");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(old));
    expect(await readAgentHistory("legacy")).toStrictEqual(old);
    await expect(access(file)).rejects.toThrow();
    await access(`${file}.bak`);
    expect(await readAgentHistory("legacy")).toStrictEqual(old);
  } finally {
    closeHistoryStore();
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
