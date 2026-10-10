import { expect, test } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addVersion,
  cutAt,
  switchVersion,
  versionsOf,
} from "../src/modules/agent/model/branches.ts";
import { turnChanges } from "../src/modules/agent/lib/turn-changes.ts";
import { applyAgentEvent } from "../src/modules/agent/model/turn-events.ts";
import { latestPlan } from "../src/modules/agent/lib/plan.ts";
import { chatMarkdown } from "../src/modules/agent/lib/export.ts";
import { readAgentHistory, writeAgentHistory } from "../server/modules/agent/index.ts";

const turn = (id, role, text = id) => ({ id, role, text, tools: [] });
const ids = (turns) => turns.map((item) => item.id).join(",");

test("editing a message keeps the cut turns as another version of that point", () => {
  const turns = [
    turn("u1", "user"),
    turn("a1", "assistant"),
    turn("u2", "user"),
    turn("a2", "assistant"),
  ];
  const old = cutAt(turns, 2);
  expect(ids(turns)).toBe("u1,a1");
  expect(old.map(ids)).toEqual(["u2,a2"]);
  const edited = turn("u3", "user");
  addVersion(edited, old);
  turns.push(edited, turn("a3", "assistant"));
  expect(versionsOf(edited)).toEqual({ count: 2, position: 1 });
});

test("switching shows the other version and keeps every version reachable", () => {
  const turns = [turn("u1", "user"), turn("a1", "assistant")];
  const first = cutAt(turns, 0);
  const second = turn("u2", "user");
  addVersion(second, first);
  turns.push(second, turn("a2", "assistant"));
  const third = cutAt(turns, 0);
  const head = turn("u3", "user");
  addVersion(head, third);
  turns.push(head, turn("a3", "assistant"));
  expect(versionsOf(head)).toEqual({ count: 3, position: 2 });

  expect(switchVersion(turns, 0, 0)).toBe(true);
  expect(ids(turns)).toBe("u1,a1");
  expect(versionsOf(turns[0])).toEqual({ count: 3, position: 0 });
  expect(switchVersion(turns, 0, 1)).toBe(true);
  expect(ids(turns)).toBe("u2,a2");
  expect(switchVersion(turns, 0, 2)).toBe(true);
  expect(ids(turns)).toBe("u3,a3");
  expect(switchVersion(turns, 0, 2)).toBe(false);
  expect(switchVersion(turns, 0, 5)).toBe(false);
  // Cutting a shown version again keeps the order of all the versions.
  const all = cutAt(turns, 0);
  expect(all.map(ids)).toEqual(["u1,a1", "u2,a2", "u3,a3"]);
});

test("the edited files of an answer are counted per file and failed calls are skipped", () => {
  const tool = (name, input, status = "done") => ({
    id: Math.random().toString(),
    name,
    status,
    input: JSON.stringify(input),
    detail: "",
  });
  const changes = turnChanges(
    [
      tool("Write", { file_path: "/p/a.txt", content: "1\n2\n3" }),
      tool("Edit", { file_path: "/p/a.txt", old_string: "1", new_string: "x\ny" }),
      tool("MultiEdit", { file_path: "/p/b.txt", edits: [{ old_string: "a", new_string: "b" }] }),
      tool("Edit", { file_path: "/p/c.txt", old_string: "a", new_string: "b" }, "error"),
      tool("Bash", { command: "ls" }),
    ],
    "/p",
  );
  expect(changes).toEqual([
    { path: "a.txt", added: 5, removed: 1 },
    { path: "b.txt", added: 1, removed: 1 },
  ]);
});

test("the plan is the last TodoWrite of the answer", () => {
  const answer = {
    ...turn("a", "assistant"),
    tools: [
      {
        id: "1",
        name: "TodoWrite",
        status: "done",
        detail: "",
        input: JSON.stringify({ todos: [{ content: "old", status: "pending" }] }),
      },
      {
        id: "2",
        name: "TodoWrite",
        status: "done",
        detail: "",
        input: JSON.stringify({
          todos: [
            { content: "one", status: "completed", activeForm: "Doing one" },
            { content: "two", status: "in_progress" },
            { content: "bad", status: "weird" },
          ],
        }),
      },
    ],
  };
  expect(latestPlan(answer).map((item) => `${item.content}:${item.status}`)).toEqual([
    "one:completed",
    "two:in_progress",
  ]);
  expect(latestPlan(turn("u", "user"))).toEqual([]);
});

test("the chat exports as markdown", () => {
  const text = chatMarkdown(
    [
      turn("u", "user", "Привет"),
      {
        ...turn("a", "assistant", "Здравствуйте"),
        parts: [{ type: "text", text: "Здравствуйте" }],
      },
    ],
    "Claude Code · сегодня",
  );
  expect(text).toContain("## Вы\n\nПривет");
  expect(text).toContain("Здравствуйте");
});

test("saved history keeps versions of a conversation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "projector-branches-"));
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
    await rm(dir, { recursive: true, force: true });
  }
});

test("a call before any text is listed once among the parts of the answer", () => {
  const state = {
    phase: "",
    permissions: [],
    commands: [],
    controls: [],
    selection: {},
    error: "",
  };
  const answer = turn("a", "assistant", "");
  applyAgentEvent(
    state,
    answer,
    { event: "tool", data: { id: "t1", name: "Write", input: {} } },
    () => {},
  );
  applyAgentEvent(state, answer, { event: "text", data: { text: "Готово" } }, () => {});
  expect(answer.parts).toEqual([
    { type: "tool", id: "t1" },
    { type: "text", text: "Готово" },
  ]);
});
