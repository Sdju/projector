import { expect, test } from "vite-plus/test";
import {
  addVersion,
  cutAt,
  switchVersion,
  versionsOf,
} from "../modules/agent-core/model/branches.ts";
import { turnChanges } from "../modules/agent-core/lib/turn-changes.ts";
import { applyAgentEvent } from "../modules/agent-core/model/turn-events.ts";
import { latestPlan, shownPlan } from "../modules/agent-core/lib/plan.ts";
import { chatMarkdown } from "../modules/agent/lib/export.ts";
import { registerBuiltinClientAgents } from "../app/agents.ts";
import { readTodosPlan, registerClientAgent } from "../modules/agents-integration/catalog/index.ts";
import IconBot from "~icons/lucide/bot";

registerBuiltinClientAgents();

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

  // OpenCode passes camelCase fields (`oldString`, `newString`) with surrounding context and reports
  // exact counts in `detail.metadata.files`.
  const opencode = turnChanges(
    [
      tool("edit", {
        path: "/p/c.ts",
        oldString: "keep\nold\nend",
        newString: "keep\nnew1\nnew2\nend",
      }),
      {
        id: "m1",
        name: "edit",
        status: "done",
        input: "{broken",
        detail: JSON.stringify({
          metadata: { files: [{ file: "src/d.vue", additions: 9, deletions: 5 }] },
        }),
      },
    ],
    "/p",
  );
  expect(opencode).toEqual([
    { path: "c.ts", added: 2, removed: 1 },
    { path: "src/d.vue", added: 9, removed: 5 },
  ]);
});

test("the plan is the last plan call of the answer", () => {
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
  expect(latestPlan(answer, "claude-code").map((item) => `${item.content}:${item.status}`)).toEqual(
    ["one:completed", "two:in_progress"],
  );
  expect(latestPlan(turn("u", "user"), "claude-code")).toEqual([]);
});

test("a plugin's create_plan and update_todos carry the plan too", () => {
  registerClientAgent({
    backend: "plan-plugin",
    program: "plan-plugin",
    title: "Plan Plugin",
    caption: "Fixture",
    icon: IconBot,
    plan: readTodosPlan(["create_plan", "update_todos"]),
  });
  const answer = {
    ...turn("a", "assistant"),
    tools: [
      {
        id: "1",
        name: "create_plan",
        status: "done",
        detail: "",
        input: JSON.stringify({ todos: [{ content: "old", status: "pending" }] }),
      },
      {
        id: "2",
        name: "update_todos",
        status: "done",
        detail: "",
        input: JSON.stringify({
          todos: [
            { content: "one", status: "completed" },
            { content: "two", status: "in_progress" },
          ],
        }),
      },
    ],
  };
  expect(latestPlan(answer, "plan-plugin").map((item) => `${item.content}:${item.status}`)).toEqual(
    ["one:completed", "two:in_progress"],
  );
  expect(latestPlan(answer, "claude-code")).toEqual([]);
});

test("Kimi's TodoList carries the plan too", () => {
  const answer = {
    ...turn("a", "assistant"),
    tools: [
      {
        id: "1",
        name: "TodoList",
        status: "done",
        detail: "",
        input: JSON.stringify({
          todos: [
            { title: "one", status: "in_progress" },
            { title: "two", status: "done" },
          ],
        }),
      },
      // Kimi reads the list by calling without `todos`: that call must not erase the plan.
      { id: "2", name: "TodoList", status: "done", detail: "", input: "{}" },
    ],
  };
  expect(latestPlan(answer, "kimi").map((item) => `${item.content}:${item.status}`)).toEqual([
    "one:in_progress",
    "two:completed",
  ]);
  // Another agent's reader does not know Kimi's tool, so the list stays with Kimi.
  expect(latestPlan(answer, "claude-code")).toEqual([]);
});

test("a cleared plan does not fall back to an earlier answer", () => {
  const open = {
    ...turn("a1", "assistant"),
    tools: [
      {
        id: "1",
        name: "TodoList",
        status: "done",
        detail: "",
        input: JSON.stringify({ todos: [{ title: "one", status: "pending" }] }),
      },
    ],
  };
  const cleared = {
    ...turn("a2", "assistant"),
    tools: [
      {
        id: "2",
        name: "TodoList",
        status: "done",
        detail: "",
        input: JSON.stringify({ todos: [] }),
      },
    ],
  };
  expect(shownPlan([turn("u1", "user"), open, turn("u2", "user"), cleared], "kimi")).toEqual([]);
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
