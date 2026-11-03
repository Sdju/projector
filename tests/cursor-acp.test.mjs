import { expect, test } from "vite-plus/test";
import {
  initializeAcp,
  mergeClientCapabilities,
} from "../packages/server/modules/agents/acp/acp-process.ts";
import { registerAcpProgram } from "../packages/server/modules/agents/acp/acp-programs.ts";
import { createCursorDialect } from "../packages/server/modules/agents/cursor/dialect.ts";
import { showCursorImage } from "../packages/server/modules/agents/cursor/images.ts";
import { cursorProgram } from "../packages/server/modules/agents/cursor/index.ts";
import { createCursorPlan } from "../packages/server/modules/agents/cursor/plan.ts";
import { normalizeCursorSelection } from "../packages/server/modules/agents/cursor/selection.ts";
import { reportCursorTask } from "../packages/server/modules/agents/cursor/task.ts";
import { updateCursorTodos } from "../packages/server/modules/agents/cursor/todos.ts";

test("Cursor's ACP program asks for the parameterized picker and keeps guts in the adapter", () => {
  expect(cursorProgram.clientCapabilities).toEqual({
    subagents: {},
    _meta: { parameterizedModelPicker: true },
  });
  expect(Object.keys(cursorProgram.extensions).sort()).toEqual([
    "cursor/ask_question",
    "cursor/create_plan",
    "cursor/generate_image",
    "cursor/task",
    "cursor/update_todos",
  ]);
});

test("shared initialize merges the program's client capabilities one level", async () => {
  const merged = mergeClientCapabilities(
    { fs: { readTextFile: false }, elicitation: { form: {} } },
    { subagents: {}, _meta: { parameterizedModelPicker: true } },
  );
  expect(merged).toEqual({
    fs: { readTextFile: false },
    elicitation: { form: {} },
    subagents: {},
    _meta: { parameterizedModelPicker: true },
  });
  registerAcpProgram({
    id: "caps-agent",
    label: "Caps",
    command: "true",
    args: [],
    clientCapabilities: { _meta: { parameterizedModelPicker: true } },
  });
  const calls = [];
  await initializeAcp(
    {
      request: async (_method, params) => {
        calls.push(params);
        return { protocolVersion: 1, agentCapabilities: { sessionCapabilities: {} } };
      },
    },
    "caps-agent",
  );
  expect(calls[0].clientCapabilities._meta).toEqual({ parameterizedModelPicker: true });
  expect(calls[0].clientCapabilities.elicitation).toEqual({ form: {} });
});

test("an older combined model id splits into knobs once the catalog lists the base id", () => {
  const controls = [
    {
      id: "model",
      category: "model",
      name: "Model",
      current: "grok-4.6",
      options: [{ value: "grok-4.6", name: "Grok 4.6" }],
      via: "config",
    },
    {
      id: "fast",
      category: "flag",
      name: "Fast",
      current: "false",
      options: [
        { value: "true", name: "On" },
        { value: "false", name: "Off" },
      ],
      via: "config",
    },
    {
      id: "effort",
      category: "effort",
      name: "Effort",
      current: "low",
      options: [
        { value: "low", name: "Low" },
        { value: "high", name: "High" },
      ],
      via: "config",
    },
  ];
  expect(normalizeCursorSelection({ model: "grok-4.6[effort=high,fast=true]" }, controls)).toEqual({
    model: "grok-4.6",
    effort: "high",
    fast: "true",
  });
  // Variants mode still lists the combined id: leave the stored value as is.
  expect(
    normalizeCursorSelection({ model: "grok-4.6[effort=high,fast=true]" }, [
      {
        ...controls[0],
        options: [{ value: "grok-4.6[effort=high,fast=true]", name: "Grok 4.6" }],
      },
    ]),
  ).toEqual({ model: "grok-4.6[effort=high,fast=true]" });
  expect(normalizeCursorSelection({ model: "grok-4.6", fast: "false" }, controls)).toMatchObject({
    model: "grok-4.6",
    fast: "false",
  });
});

test("create_plan asks to accept and update_todos merge into the last list", async () => {
  const events = [];
  const asked = [];
  const options = {
    chat: "c1",
    emit: (event, data) => events.push([event, data]),
    ask: async (request) => {
      asked.push(request);
      return { plan: ["accept"] };
    },
  };
  expect(
    await createCursorPlan(options, {
      toolCallId: "p1",
      name: "План",
      overview: "Сделать",
      todos: [{ id: "t1", content: "one", status: "pending" }],
    }),
  ).toEqual({ outcome: { outcome: "accepted" } });
  expect(asked[0].title).toBe("План");
  expect(events[0]).toMatchObject(["tool", { name: "create_plan" }]);

  events.length = 0;
  await updateCursorTodos(
    { ...options, ask: undefined },
    {
      toolCallId: "u1",
      merge: true,
      todos: [{ id: "t2", content: "two", status: "in_progress" }],
    },
  );
  const input = events[0][1].input;
  expect(input.todos.map((item) => item.id)).toEqual(["t1", "t2"]);
});

test("generate_image and task extensions emit chat events, not protocol names outside the adapter", async () => {
  const events = [];
  const emit = (event, data) => events.push([event, data]);
  await showCursorImage(
    { emit },
    { toolCallId: "img", description: "cat", filePath: "/tmp/cat.png" },
  );
  expect(events[0]).toEqual(["text", { text: "\n\n![cat](/tmp/cat.png)\n" }]);
  events.length = 0;
  await reportCursorTask(
    { emit },
    {
      toolCallId: "task-1",
      description: "Explore",
      prompt: "look around",
      subagentType: "explore",
      durationMs: 12,
    },
  );
  expect(events[0][0]).toBe("task");
  expect(events[0][1]).toMatchObject({
    id: "task-1",
    kind: "agent",
    title: "Explore",
    status: "done",
    subagent: "explore",
    durationMs: 12,
  });
});

test("Cursor's dialect starts a task from a task tool call", () => {
  const dialect = createCursorDialect();
  const patches = dialect.call(
    {
      sessionUpdate: "tool_call",
      title: "Task",
      rawInput: { description: "Explore src", prompt: "find it", subagentType: "explore" },
    },
    "t1",
  );
  expect(patches[0]).toMatchObject({
    id: "t1",
    kind: "agent",
    title: "Explore src",
    subagent: "explore",
    status: "running",
  });
  expect(
    dialect.tool({
      title: "Read",
      parentToolCallId: "t1",
    }),
  ).toEqual({ name: "Read", parent: "t1" });
  expect(dialect.inner({ parentToolCallId: "t1" })).toBe(true);
});
