import { expect, test } from "vite-plus/test";
import {
  createAcpEventMapper,
  createAcpReplayCollector,
} from "../server/modules/agent/acp-events.ts";
import { createCodexDialect } from "../server/modules/agent/acp-dialect-codex.ts";
import { createOpencodeDialect } from "../server/modules/agent/acp-dialect-opencode.ts";

const delta = (data) => ({
  sessionUpdate: "tool_call_update",
  toolCallId: "t1",
  _meta: { terminal_output_delta: { data, terminal_id: "t1" } },
});

test("command output streamed as terminal deltas becomes the tool result", () => {
  const events = [];
  const mapper = createAcpEventMapper(
    (type, data) => events.push([type, data]),
    "Codex",
    createCodexDialect(),
  );
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call",
    toolCallId: "t1",
    title: "ls",
    status: "in_progress",
  });
  mapper.handleUpdate("s", delta("one\n"));
  mapper.handleUpdate("s", delta("two\n"));
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call_update",
    toolCallId: "t1",
    status: "completed",
  });
  expect(events.at(-1)).toEqual(["tool-result", { id: "t1", name: "ls", output: "one\ntwo\n" }]);
});

test("a failed command keeps its streamed output as the error", () => {
  const events = [];
  const mapper = createAcpEventMapper(
    (type, data) => events.push([type, data]),
    "Codex",
    createCodexDialect(),
  );
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call",
    toolCallId: "t1",
    title: "x",
    status: "in_progress",
  });
  mapper.handleUpdate("s", delta("boom"));
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call_update",
    toolCallId: "t1",
    status: "failed",
  });
  expect(events.at(-1)[1].error).toBe("boom");
});

test("replay rebuilds output from deltas too", () => {
  const collector = createAcpReplayCollector("codex", "s", createCodexDialect());
  collector.handleUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "t1",
    title: "ls",
    status: "in_progress",
  });
  collector.handleUpdate(delta("out"));
  collector.handleUpdate({
    sessionUpdate: "tool_call_update",
    toolCallId: "t1",
    status: "completed",
  });
  expect(collector.turns[0].tools[0]).toMatchObject({ status: "done", detail: "out" });
});

const child = {
  "opencode/child-session": { id: "ses_c", parentID: "ses_p", depth: 1, title: "List files" },
};

test("opencode subagent calls nest under its call and report as a task", () => {
  const events = [];
  const mapper = createAcpEventMapper(
    (type, data) => events.push([type, data]),
    "OpenCode",
    createOpencodeDialect(),
  );
  const update = (data) => mapper.handleUpdate("s", data);
  update({
    sessionUpdate: "tool_call",
    toolCallId: "sub",
    title: "subagent",
    kind: "think",
    status: "pending",
    rawInput: {},
  });
  update({
    sessionUpdate: "tool_call_update",
    toolCallId: "sub",
    status: "in_progress",
    rawInput: { agent: "explore", description: "List files", prompt: "p" },
  });
  update({
    sessionUpdate: "tool_call",
    toolCallId: "ses_c:1",
    title: "List files: shell",
    kind: "execute",
    status: "pending",
    rawInput: {},
    _meta: child,
  });
  update({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "found 3 files" },
    _meta: child,
  });
  update({
    sessionUpdate: "tool_call_update",
    toolCallId: "ses_c:1",
    status: "completed",
    content: [],
    _meta: child,
  });
  update({
    sessionUpdate: "tool_call_update",
    toolCallId: "sub",
    status: "completed",
    content: [
      {
        type: "content",
        content: { type: "text", text: '<subagent state="completed">\n3\n</subagent>' },
      },
    ],
  });
  update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "3" } });
  expect(mapper.text).toBe("3");
  expect(events.find(([type, data]) => type === "tool" && data.id === "ses_c:1")[1]).toMatchObject({
    name: "shell",
    parent: "sub",
  });
  const tasks = events.filter(([type]) => type === "task").map(([, data]) => data);
  expect(tasks[0]).toMatchObject({
    id: "sub",
    kind: "agent",
    title: "List files",
    subagent: "explore",
    status: "running",
  });
  expect(tasks).toContainEqual({ id: "sub", tools: 1, lastTool: "shell" });
  expect(tasks).toContainEqual({ id: "sub", summary: "found 3 files" });
  expect(tasks.at(-1)).toEqual({ id: "sub", status: "done", summary: "found 3 files", tools: 1 });
});

test("opencode background command is a task that its call does not end", () => {
  const events = [];
  const mapper = createAcpEventMapper(
    (type, data) => events.push([type, data]),
    "OpenCode",
    createOpencodeDialect(),
  );
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call",
    toolCallId: "sh",
    title: "shell",
    kind: "execute",
    status: "pending",
    rawInput: {},
  });
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call_update",
    toolCallId: "sh",
    status: "in_progress",
    title: "sleep 20",
    rawInput: { background: true, command: "sleep 20" },
  });
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call_update",
    toolCallId: "sh",
    status: "completed",
    content: [],
  });
  const tasks = events.filter(([type]) => type === "task").map(([, data]) => data);
  expect(tasks).toEqual([
    {
      id: "sh",
      kind: "shell",
      title: "sleep 20",
      status: "running",
      background: true,
      untracked: true,
      tool: "sh",
    },
  ]);
});

test("codex subagent start and completion calls drive one task", () => {
  const events = [];
  const mapper = createAcpEventMapper(
    (type, data) => events.push([type, data]),
    "Codex",
    createCodexDialect(),
  );
  const input = (activityKind) => ({ agentThreadId: "th1", agentPath: "/root/date", activityKind });
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call",
    toolCallId: "a",
    kind: "other",
    title: "Start subagent date",
    status: "in_progress",
    rawInput: input("started"),
  });
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call_update",
    toolCallId: "a",
    status: "completed",
  });
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call",
    toolCallId: "b",
    kind: "other",
    title: "Complete subagent date",
    status: "in_progress",
    rawInput: input("completed"),
  });
  const tasks = events.filter(([type]) => type === "task").map(([, data]) => data);
  expect(tasks).toEqual([
    { id: "th1", kind: "agent", title: "date", status: "running", background: false, tool: "a" },
    { id: "th1", status: "done" },
  ]);
});

const exec = (id) => ({
  sessionUpdate: "tool_call",
  toolCallId: id,
  kind: "execute",
  title: "sleep 25",
  status: "in_progress",
  content: [{ type: "terminal", terminalId: id }],
  rawInput: { command: "sleep 25" },
});

test("codex terminal command left open when the answer ends is a background task", () => {
  const events = [];
  const mapper = createAcpEventMapper(
    (type, data) => events.push([type, data]),
    "Codex",
    createCodexDialect(),
  );
  mapper.handleUpdate("s", exec("e1"));
  mapper.handleUpdate("s", exec("e2"));
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call_update",
    toolCallId: "e2",
    status: "completed",
  });
  expect(events.filter(([type]) => type === "task")).toEqual([]);
  mapper.finish();
  const tasks = events.filter(([type]) => type === "task").map(([, data]) => data);
  expect(tasks).toEqual([
    {
      id: "e1",
      kind: "shell",
      title: "sleep 25",
      status: "running",
      background: true,
      untracked: true,
      tool: "e1",
    },
  ]);
});

test("a terminal command that the agent moved on from ends as a finished task", () => {
  const events = [];
  const mapper = createAcpEventMapper(
    (type, data) => events.push([type, data]),
    "Codex",
    createCodexDialect(),
  );
  mapper.handleUpdate("s", exec("e1"));
  mapper.handleUpdate("s", {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "started" },
  });
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call_update",
    toolCallId: "e1",
    status: "completed",
  });
  const tasks = events.filter(([type]) => type === "task").map(([, data]) => data);
  expect(tasks.map((task) => task.status)).toEqual(["running", "done"]);
});

test("without a dialect the extensions of other agents change nothing", () => {
  const events = [];
  const mapper = createAcpEventMapper((type, data) => events.push([type, data]), "Other");
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call",
    toolCallId: "sub",
    title: "subagent",
    kind: "think",
    status: "pending",
    rawInput: { agent: "explore", description: "x", background: true, command: "sleep" },
  });
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call",
    toolCallId: "ses_c:1",
    title: "x: shell",
    status: "pending",
    rawInput: {},
    _meta: child,
  });
  mapper.finish();
  expect(events.filter(([type]) => type === "task")).toEqual([]);
  expect(events.find(([, data]) => data.id === "ses_c:1")[1]).toMatchObject({ name: "x: shell" });
  expect(events.find(([, data]) => data.id === "ses_c:1")[1].parent).toBeUndefined();
});

test("replaying an opencode session nests subagent calls and drops their text", () => {
  const collector = createAcpReplayCollector("opencode", "s", createOpencodeDialect());
  collector.handleUpdate({
    sessionUpdate: "user_message_chunk",
    content: { type: "text", text: "go" },
  });
  collector.handleUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "sub",
    title: "subagent",
    kind: "think",
    status: "pending",
    rawInput: {},
  });
  collector.handleUpdate({
    sessionUpdate: "tool_call_update",
    toolCallId: "sub",
    status: "in_progress",
    rawInput: { agent: "explore", description: "List files" },
  });
  collector.handleUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "ses_c:1",
    title: "List files: shell",
    kind: "execute",
    status: "pending",
    rawInput: {},
    _meta: child,
  });
  collector.handleUpdate({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "inner" },
    _meta: child,
  });
  collector.handleUpdate({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "done" },
  });
  const answer = collector.turns.at(-1);
  expect(answer.text).toBe("done");
  expect(answer.tools.find((tool) => tool.id === "ses_c:1")).toMatchObject({
    name: "shell",
    parent: "sub",
  });
});

test("opencode unwraps the subagent result when nothing was said", () => {
  const events = [];
  const mapper = createAcpEventMapper(
    (type, data) => events.push([type, data]),
    "OpenCode",
    createOpencodeDialect(),
  );
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call",
    toolCallId: "sub",
    title: "subagent",
    status: "pending",
    rawInput: {},
  });
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call_update",
    toolCallId: "sub",
    status: "in_progress",
    rawInput: { agent: "explore", description: "d" },
  });
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call_update",
    toolCallId: "sub",
    status: "completed",
    content: [
      {
        type: "content",
        content: {
          type: "text",
          text: '<subagent sessionID="x" state="completed">\n42\n</subagent>',
        },
      },
    ],
  });
  expect(events.filter(([type]) => type === "task").at(-1)[1]).toMatchObject({
    status: "done",
    summary: "42",
  });
});
