import { expect, test } from "vite-plus/test";
import { createCursorDialect } from "../src/dialect.ts";
import { showCursorImage } from "../src/images.ts";
import { createAgents, cursorProgram } from "../src/index.ts";
import { createCursorPlan } from "../src/plan.ts";
import { normalizeCursorSelection } from "../src/selection.ts";
import { reportCursorTask } from "../src/task.ts";
import { updateCursorTodos } from "../src/todos.ts";
import {
  extendPlainDialect,
  inputOf,
  isOver,
  shorten,
} from "../../../packages/server/modules/agents/acp/index.ts";

/** The runtime a trusted plugin receives: the real ACP helpers, a stub backend factory. */
const testApi = (createAcpBackend = (program) => program) => ({
  version: 1,
  createAcpBackend,
  acp: { extendPlainDialect, inputOf, isOver, shorten },
});

const extensionNames = [
  "cursor/ask_question",
  "cursor/create_plan",
  "cursor/generate_image",
  "cursor/task",
  "cursor/update_todos",
];

test("Cursor's ACP program asks for the parameterized picker and keeps guts in the adapter", () => {
  const program = cursorProgram(testApi());
  expect(program.clientCapabilities).toEqual({
    subagents: {},
    _meta: { parameterizedModelPicker: true },
  });
  expect(Object.keys(program.extensions).sort()).toEqual(extensionNames);
});

test("the plugin contributes exactly the Cursor backend with its five extensions", () => {
  const backends = createAgents(testApi());
  expect(backends).toHaveLength(1);
  const [backend] = backends;
  expect(backend.id).toBe("cursor");
  expect(backend.label).toBe("Cursor");
  expect(backend.command).toBe("agent");
  expect(backend.args).toEqual(["acp"]);
  expect(backend.terminal).toEqual({ executable: "agent" });
  expect(backend.dialect).toBeTypeOf("function");
  expect(Object.keys(backend.extensions).sort()).toEqual(extensionNames);
  expect(backend.plan).toEqual({ tools: ["create_plan", "update_todos"] });
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
  const dialect = createCursorDialect(testApi());
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
