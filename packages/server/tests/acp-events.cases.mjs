import { expect, test, vi } from "vite-plus/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAcpEventMapper,
  createAcpReplayCollector,
} from "../modules/agents/acp/acp-events.ts";
import { extendPlainDialect, isCompactCommand } from "../modules/agents/acp/acp-dialect.ts";
import { createCodexDialect } from "../modules/agents/codex/dialect.ts";
import { createKimiDialect } from "../modules/agents/kimi/dialect.ts";
import { kimiBackgroundState } from "../modules/agents/kimi/background-state.ts";
import { createOpencodeDialect } from "../modules/agents/opencode/dialect.ts";

/** A dialect that marks one tool as a tracked background agent until a later end patch. */
function createBackgroundHoldDialect() {
  const open = new Set();
  return extendPlainDialect({
    call(update, id) {
      if (update.title !== "Agent" || open.has(id)) return [];
      open.add(id);
      return [
        {
          id,
          kind: "agent",
          title: "hold",
          status: "running",
          background: true,
          tool: id,
        },
      ];
    },
    end(update, id) {
      if (!open.delete(id)) return [];
      return [
        {
          id,
          status: update.status === "failed" ? "error" : "done",
        },
      ];
    },
  });
}

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
  expect(
    events.filter(([type]) => type === "tool-output").map(([, data]) => data.chunk),
  ).toStrictEqual(["one\n", "two\n"]);
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call_update",
    toolCallId: "t1",
    status: "completed",
  });
  expect(events.at(-1)).toEqual(["tool-result", { id: "t1", name: "ls", output: "one\ntwo\n" }]);
});

test("what the agent says to display wins over rawOutput metadata", () => {
  const events = [];
  const mapper = createAcpEventMapper((type, data) => events.push([type, data]), "OpenCode");
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call",
    toolCallId: "t1",
    title: "shell",
    kind: "execute",
    status: "pending",
    rawInput: { command: "ls" },
  });
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call_update",
    toolCallId: "t1",
    status: "completed",
    content: [{ type: "content", content: { type: "text", text: "file.txt\n" } }],
    rawOutput: { metadata: { status: "completed", truncated: false, exit: 0 } },
  });
  expect(events.at(-1)).toEqual(["tool-result", { id: "t1", name: "shell", output: "file.txt\n" }]);
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

const readResult = (id, text) => ({
  sessionUpdate: "tool_call_update",
  toolCallId: id,
  status: "completed",
  content: [{ type: "content", content: { type: "text", text } }],
});

test("kimi read result loses its numbered lines", () => {
  const events = [];
  const mapper = createAcpEventMapper(
    (type, data) => events.push([type, data]),
    "Kimi",
    createKimiDialect(),
  );
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call",
    toolCallId: "r1",
    title: "Reading AGENTS.md",
    kind: "read",
    status: "in_progress",
    rawInput: { path: "AGENTS.md" },
  });
  mapper.handleUpdate("s", readResult("r1", "1\t# Projector\n2\t\n3\tЛокальный лаунчер\n4\tКонец"));
  expect(events.at(-1)).toEqual([
    "tool-result",
    { id: "r1", name: "Reading AGENTS.md", output: "# Projector\n\nЛокальный лаунчер\nКонец" },
  ]);
});

test("kimi leaves text that is not a numbered read untouched", () => {
  const events = [];
  const mapper = createAcpEventMapper(
    (type, data) => events.push([type, data]),
    "Kimi",
    createKimiDialect(),
  );
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call",
    toolCallId: "b1",
    title: "Running tests",
    kind: "execute",
    status: "in_progress",
  });
  mapper.handleUpdate("s", readResult("b1", "1\tnot a file\nplain line"));
  expect(events.at(-1)).toEqual([
    "tool-result",
    { id: "b1", name: "Running tests", output: "1\tnot a file\nplain line" },
  ]);
});

test.each([
  ["completed", "done"],
  ["failed", "error"],
  ["lost", "stopped"],
])("kimi background Agent holds ACP until the native task record is %s", async (native, chat) => {
  const home = await mkdtemp(join(tmpdir(), "projector-kimi-tasks-"));
  try {
    const taskDirectory = join(home, ".kimi-code/sessions/wd_test/session_s/agents/main/tasks");
    await mkdir(taskDirectory, { recursive: true });
    const manifest = join(taskDirectory, "agent-x.json");
    const events = [];
    const mapper = createAcpEventMapper(
      (type, data) => events.push([type, data]),
      "Kimi",
      createKimiDialect(kimiBackgroundState(home)),
      { sessionId: () => "session_s" },
    );
    mapper.handleUpdate("s", {
      sessionUpdate: "tool_call",
      toolCallId: "a1",
      title: "Agent",
      kind: "other",
      status: "in_progress",
      rawInput: {
        description: "Fix trust",
        subagent_type: "coder",
        run_in_background: true,
        prompt: "do it",
      },
    });
    expect(events).toContainEqual([
      "task",
      {
        id: "a1",
        kind: "agent",
        title: "Fix trust",
        status: "running",
        background: true,
        subagent: "coder",
        prompt: "do it",
        tool: "a1",
      },
    ]);
    expect(mapper.pendingBackground).toBe(1);
    expect(mapper.keepsProcess).toBe(true);
    mapper.handleUpdate(
      "s",
      readResult(
        "a1",
        "task_id: agent-x\nstatus: running\nagent_id: agent-0\nactual_subagent_type: coder\nautomatic_notification: true\n\ndescription: Fix trust\n",
      ),
    );
    expect(mapper.pendingBackground).toBe(1);
    expect(mapper.keepsProcess).toBe(true);
    const tasks = events.filter(([type]) => type === "task").map(([, data]) => data);
    expect(tasks.at(-1)).toMatchObject({
      id: "a1",
      status: "running",
      background: true,
      session: "agent-0",
      subagent: "coder",
    });
    await writeFile(manifest, "{");
    expect(mapper.pollBackground()).toBe(1);
    await writeFile(
      manifest,
      JSON.stringify({ kind: "agent", taskId: "other", status: "completed" }),
    );
    expect(mapper.pollBackground()).toBe(1);
    const settled = mapper.waitBackground();
    await writeFile(
      manifest,
      JSON.stringify({
        kind: "agent",
        taskId: "agent-x",
        status: native,
        endedAt: 123,
      }),
    );
    expect(mapper.pollBackground()).toBe(0);
    await settled;
    expect(events.at(-1)).toEqual(["task", { id: "a1", status: chat, endedAt: 123 }]);
    expect(mapper.keepsProcess).toBe(false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("kimi background Agent terminal receipt releases the connection hold", () => {
  const events = [];
  const mapper = createAcpEventMapper(
    (type, data) => events.push([type, data]),
    "Kimi",
    createKimiDialect(),
  );
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call",
    toolCallId: "a2",
    title: "Agent",
    kind: "other",
    status: "in_progress",
    rawInput: {
      description: "Fix trust",
      subagent_type: "coder",
      run_in_background: true,
      prompt: "do it",
    },
  });
  expect(mapper.keepsProcess).toBe(true);
  mapper.handleUpdate(
    "s",
    readResult(
      "a2",
      "agent_id: agent-0\nactual_subagent_type: coder\nstatus: failed\nstop_reason: provider_error\n\nsubagent error: quota\n",
    ),
  );
  expect(mapper.pendingBackground).toBe(0);
  expect(mapper.keepsProcess).toBe(false);
  const tasks = events.filter(([type]) => type === "task").map(([, data]) => data);
  expect(tasks.at(-1)).toMatchObject({
    id: "a2",
    status: "error",
    background: true,
    session: "agent-0",
    subagent: "coder",
  });
});

test("opencode read result loses its frame and line numbers", () => {
  const events = [];
  const mapper = createAcpEventMapper(
    (type, data) => events.push([type, data]),
    "OpenCode",
    createOpencodeDialect(),
  );
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call",
    toolCallId: "r1",
    title: "read",
    kind: "read",
    status: "pending",
    rawInput: {},
  });
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call_update",
    toolCallId: "r1",
    status: "in_progress",
    rawInput: { path: "/p/a.ts" },
  });
  mapper.handleUpdate(
    "s",
    readResult("r1", "Read file /p/a.ts, lines 3-5\n3: const a = 1;\n4: \n5: const b = 2;"),
  );
  expect(events.at(-1)).toEqual([
    "tool-result",
    { id: "r1", name: "read", output: "const a = 1;\n\nconst b = 2;" },
  ]);
});

test("opencode read handles an empty file and a truncated tail", () => {
  const events = [];
  const mapper = createAcpEventMapper(
    (type, data) => events.push([type, data]),
    "OpenCode",
    createOpencodeDialect(),
  );
  const read = (id, text) => {
    mapper.handleUpdate("s", {
      sessionUpdate: "tool_call",
      toolCallId: id,
      title: "read",
      kind: "read",
      status: "pending",
      rawInput: {},
    });
    mapper.handleUpdate("s", readResult(id, text));
    return events.at(-1)[1].output;
  };
  expect(read("empty", "Read file /p/empty.ts, 0 lines")).toBe("");
  expect(
    read(
      "tail",
      "Read file /p/a.ts, lines 1-2\n1: a\n2: b\n[Output truncated. Continue reading with offset: 3]",
    ),
  ).toBe("a\nb\n[Output truncated. Continue reading with offset: 3]");
});

test("opencode leaves the result of a non-read call untouched", () => {
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
    rawInput: { command: "cat a.ts" },
  });
  mapper.handleUpdate("s", readResult("sh", "Read file /p/a.ts, lines 1-1\n1: a"));
  expect(events.at(-1)).toEqual([
    "tool-result",
    { id: "sh", name: "shell", output: "Read file /p/a.ts, lines 1-1\n1: a" },
  ]);
});

test("opencode replay stores the cleaned read result", () => {
  const collector = createAcpReplayCollector("opencode", "s", createOpencodeDialect());
  collector.handleUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "r1",
    title: "read",
    kind: "read",
    status: "pending",
    rawInput: {},
  });
  collector.handleUpdate(readResult("r1", "Read file /p/a.ts, lines 1-1\n1: const a = 1;"));
  expect(collector.turns[0].tools[0]).toMatchObject({ status: "done", detail: "const a = 1;" });
});

test("opencode background subagent hold clears when OpenCode idle_outcome is set", async () => {
  vi.useFakeTimers();
  try {
    const events = [];
    const outcomes = new Map();
    const mapper = createAcpEventMapper(
      (type, data) => events.push([type, data]),
      "OpenCode",
      createOpencodeDialect({
        idleOutcomes: (ids) => {
          const found = new Map();
          for (const id of ids) if (outcomes.has(id)) found.set(id, outcomes.get(id));
          return found;
        },
      }),
    );
    mapper.handleUpdate("s", {
      sessionUpdate: "tool_call_update",
      toolCallId: "sub",
      status: "in_progress",
      rawInput: { agent: "general", background: true, description: "Fix trust" },
    });
    mapper.handleUpdate(
      "s",
      readResult(
        "sub",
        "The subagent is working in the background (sessionID: ses_idle1). You will be notified automatically when it finishes.\n",
      ),
    );
    expect(mapper.pendingBackground).toBe(1);
    let released = false;
    const waiting = mapper.waitBackground().then(() => {
      released = true;
    });
    await Promise.resolve();
    expect(released).toBe(false);
    outcomes.set("ses_idle1", "done");
    await vi.advanceTimersByTimeAsync(1000);
    await waiting;
    expect(released).toBe(true);
    expect(mapper.pendingBackground).toBe(0);
    expect(events.filter(([type]) => type === "task").at(-1)?.[1]).toMatchObject({
      id: "sub",
      status: "done",
      background: true,
      session: "ses_idle1",
    });
  } finally {
    vi.useRealTimers();
  }
});

test("opencode background subagent holds the connection until notify", async () => {
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
    kind: "think",
    status: "pending",
    rawInput: {},
  });
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call_update",
    toolCallId: "sub",
    status: "in_progress",
    rawInput: {
      agent: "general",
      background: true,
      description: "Fix trust",
      prompt: "do it",
    },
  });
  expect(mapper.pendingBackground).toBe(1);
  expect(mapper.keepsProcess).toBe(true);
  mapper.handleUpdate(
    "s",
    readResult(
      "sub",
      "The subagent is working in the background (sessionID: ses_child1). You will be notified automatically when it finishes.\n",
    ),
  );
  expect(mapper.pendingBackground).toBe(1);
  let released = false;
  const waiting = mapper.waitBackground().then(() => {
    released = true;
  });
  await Promise.resolve();
  expect(released).toBe(false);
  mapper.handleUpdate("s", {
    sessionUpdate: "agent_message_chunk",
    content: {
      type: "text",
      text: '<subagent sessionID="ses_child1" state="completed">\nok\n</subagent>',
    },
  });
  await waiting;
  expect(released).toBe(true);
  expect(mapper.pendingBackground).toBe(0);
  const tasks = events.filter(([type]) => type === "task").map(([, data]) => data);
  expect(tasks[0]).toMatchObject({
    id: "sub",
    kind: "agent",
    title: "Fix trust",
    status: "running",
    background: true,
    subagent: "general",
    prompt: "do it",
  });
  expect(tasks).toContainEqual(
    expect.objectContaining({
      id: "sub",
      status: "running",
      background: true,
      session: "ses_child1",
    }),
  );
  expect(tasks.at(-1)).toMatchObject({
    id: "sub",
    status: "done",
    background: true,
    session: "ses_child1",
  });
});

test("a finished background hold is remembered for the agent's own next step", () => {
  const mapper = createAcpEventMapper(() => {}, "Hold", createBackgroundHoldDialect());
  expect(mapper.hadBackground).toBe(false);
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call",
    toolCallId: "bg",
    title: "Agent",
    status: "pending",
  });
  expect(mapper.hadBackground).toBe(true);
  expect(mapper.pendingBackground).toBe(1);
  mapper.finish();
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call_update",
    toolCallId: "bg",
    title: "Agent",
    status: "completed",
  });
  // The hold is gone, but the agent may still answer the report: the run must not forget it.
  expect(mapper.pendingBackground).toBe(0);
  expect(mapper.hadBackground).toBe(true);
});

test("a soft hold keeps the process but does not ask for a follow-up step", () => {
  const mapper = createAcpEventMapper(
    () => {},
    "Kimi",
    extendPlainDialect({
      call(update, id) {
        return update.title === "Agent"
          ? [{ id, status: "running", background: true, hold: false, tool: id }]
          : [];
      },
    }),
  );
  mapper.handleUpdate("s", { sessionUpdate: "tool_call", toolCallId: "soft", title: "Agent" });
  expect(mapper.pendingBackground).toBe(0);
  expect(mapper.hadBackground).toBe(false);
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

test("a finished background command reports its exit status instead of staying without a result", () => {
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
    name: "exec_command",
    status: "failed",
    _meta: { terminal_exit: { exit_code: 1, signal: null, terminal_id: "e1" } },
  });
  const tasks = events.filter(([type]) => type === "task").map(([, data]) => data);
  expect(tasks.at(-1)).toEqual({
    id: "e1",
    status: "error",
    summary: "Код выхода 1",
  });
  expect(events.at(-1)[1]).toMatchObject({ id: "e1", error: "Код выхода 1" });
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

test("opencode provider retries become a visible retrying status", () => {
  const events = [];
  const mapper = createAcpEventMapper(
    (type, data) => events.push([type, data]),
    "OpenCode",
    createOpencodeDialect(),
  );
  const nextRetryAt = new Date(Date.now() + 5000).toISOString();
  mapper.handleUpdate("s", {
    sessionUpdate: "session_info_update",
    _meta: {
      "opencode/retry": {
        attempt: 2,
        nextRetryAt,
        error: { message: "Upstream request failed: [overloaded]", status: 429 },
      },
    },
  });

  expect(events.at(-1)[0]).toBe("status");
  expect(events.at(-1)[1]).toMatchObject({
    phase: "retrying",
    attempt: 1,
    message: "Upstream request failed: [overloaded]",
    provider: "OpenCode",
  });
  expect(events.at(-1)[1].delay).toBeGreaterThan(0);

  // The retry started: the chat goes back to its normal thinking status.
  mapper.handleUpdate("s", {
    sessionUpdate: "session_info_update",
    _meta: { "opencode/retry": null },
  });
  expect(events.at(-1)).toEqual(["status", { phase: "thinking", provider: "OpenCode", model: "" }]);
});

test("other agents' session info does not invent retries", () => {
  const events = [];
  const mapper = createAcpEventMapper((type, data) => events.push([type, data]), "Other");
  mapper.handleUpdate("s", {
    sessionUpdate: "session_info_update",
    _meta: { "opencode/retry": { attempt: 2 } },
  });
  expect(events).toEqual([]);
});

test("a manual /compact shows its progress and the summary as the answer", () => {
  expect(isCompactCommand(" /compact ")).toBe(true);
  expect(isCompactCommand("/compact focus on tests")).toBe(true);
  expect(isCompactCommand("/compaction")).toBe(false);
  expect(isCompactCommand("/anything", [{ type: "command", name: "Compact" }])).toBe(true);
  const events = [];
  const mapper = createAcpEventMapper(
    (type, data) => events.push([type, data]),
    "OpenCode",
    createOpencodeDialect(),
    { compactCommand: true },
  );
  mapper.handleUpdate("s", {
    sessionUpdate: "compaction_update",
    compactionId: "c1",
    status: "in_progress",
  });
  expect(events.at(-1)).toEqual(["status", { phase: "compacting" }]);
  // Chunks stream the same summary that the completed update carries: keep them out of the chat.
  mapper.handleUpdate("s", {
    sessionUpdate: "compaction_summary_chunk",
    compactionId: "c1",
    content: { type: "text", text: "half" },
  });
  expect(events.filter(([type]) => type !== "status")).toEqual([]);
  mapper.handleUpdate("s", {
    sessionUpdate: "compaction_update",
    compactionId: "c1",
    status: "completed",
    summary: [{ type: "text", text: "## Сводка\n- сделано" }],
  });
  expect(events).toContainEqual(["text", { text: "## Сводка\n- сделано" }]);
  expect(events.at(-1)).toEqual(["status", { phase: "thinking", provider: "OpenCode", model: "" }]);
  expect(mapper.text).toBe("## Сводка\n- сделано");
});

test("an automatic compaction leaves a note and does not replace the answer", () => {
  const events = [];
  const mapper = createAcpEventMapper(
    (type, data) => events.push([type, data]),
    "OpenCode",
    createOpencodeDialect(),
  );
  mapper.handleUpdate("s", {
    sessionUpdate: "compaction_update",
    compactionId: "c2",
    status: "completed",
    summary: [{ type: "text", text: "long summary" }],
  });
  expect(events).toContainEqual(["input", { text: "Контекст сжат", inputId: "compaction:c2" }]);
  expect(mapper.text).toBe("");
});

test("opencode compaction markers of older builds are visible too", () => {
  const events = [];
  const mapper = createAcpEventMapper(
    (type, data) => events.push([type, data]),
    "OpenCode",
    createOpencodeDialect(),
    { compactCommand: true },
  );
  mapper.handleUpdate("s", {
    sessionUpdate: "session_info_update",
    _meta: { "opencode/compaction": { status: "started", messageId: "m1", reason: "manual" } },
  });
  expect(events.at(-1)).toEqual(["status", { phase: "compacting" }]);
  mapper.handleUpdate("s", {
    sessionUpdate: "session_info_update",
    _meta: { "opencode/compaction": { status: "completed", messageId: "m1", reason: "manual" } },
  });
  expect(events).toContainEqual(["text", { text: "Контекст сжат." }]);
});

test("a failed compaction is reported without failing the answer", () => {
  const events = [];
  const mapper = createAcpEventMapper(
    (type, data) => events.push([type, data]),
    "OpenCode",
    createOpencodeDialect(),
  );
  mapper.handleUpdate("s", {
    sessionUpdate: "compaction_update",
    compactionId: "c3",
    status: "failed",
    error: { message: "provider overloaded" },
  });
  expect(events).toContainEqual([
    "input",
    { text: "Не удалось сжать контекст: provider overloaded", inputId: "compaction:c3" },
  ]);
  expect(events.some(([type]) => type === "error")).toBe(false);
});

test("replaying a compacted session marks where the context was compacted", () => {
  const collector = createAcpReplayCollector("opencode", "s", createOpencodeDialect());
  collector.handleUpdate({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "answer" },
  });
  collector.handleUpdate({
    sessionUpdate: "compaction_update",
    compactionId: "c4",
    status: "completed",
    summary: [{ type: "text", text: "long summary" }],
  });
  expect(collector.turns.at(-1).parts).toContainEqual({ type: "note", text: "Контекст сжат" });
});

test("tracked background tasks hold waitBackground until they end", async () => {
  const mapper = createAcpEventMapper(() => {}, "Test", createBackgroundHoldDialect());
  expect(mapper.pendingBackground).toBe(0);
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call",
    toolCallId: "bg1",
    title: "Agent",
    status: "pending",
  });
  expect(mapper.pendingBackground).toBe(1);
  mapper.finish();
  expect(mapper.pendingBackground).toBe(1);
  let released = false;
  const waiting = mapper.waitBackground().then(() => {
    released = true;
  });
  await Promise.resolve();
  expect(released).toBe(false);
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call_update",
    toolCallId: "bg1",
    title: "Agent",
    status: "completed",
    content: [{ type: "content", content: { type: "text", text: "ok" } }],
  });
  expect(mapper.pendingBackground).toBe(0);
  await waiting;
  expect(released).toBe(true);
});

test("untracked background tasks do not hold the ACP connection", async () => {
  const dialect = extendPlainDialect({
    call(_update, id) {
      return [
        {
          id,
          kind: "shell",
          title: "sleep",
          status: "running",
          background: true,
          untracked: true,
          tool: id,
        },
      ];
    },
  });
  const mapper = createAcpEventMapper(() => {}, "Test", dialect);
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call",
    toolCallId: "u1",
    title: "shell",
    status: "pending",
  });
  expect(mapper.pendingBackground).toBe(0);
  await mapper.waitBackground();
});

test("waitBackground resolves immediately when abort fires", async () => {
  const mapper = createAcpEventMapper(() => {}, "Test", createBackgroundHoldDialect());
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call",
    toolCallId: "bg2",
    title: "Agent",
    status: "pending",
  });
  const abort = new AbortController();
  const waiting = mapper.waitBackground(abort.signal);
  abort.abort();
  await waiting;
  expect(mapper.pendingBackground).toBe(1);
});

test("live and replay decode the same ACP text, diff and raw output", () => {
  const events = [];
  const live = createAcpEventMapper((event, data) => events.push({ event, data }), "Test ACP");
  const replay = createAcpReplayCollector("test", "test-session");
  const updates = [
    { sessionUpdate: "agent_message_chunk", content: [{ text: "Part " }, { text: "one" }] },
    {
      sessionUpdate: "tool_call",
      toolCallId: "diff",
      title: "Edit",
      status: "completed",
      content: [
        { type: "content", content: { text: "Changed" } },
        { type: "diff", path: 42, oldText: "before", newText: "after" },
      ],
      rawOutput: "metadata",
    },
    {
      sessionUpdate: "tool_call",
      toolCallId: "raw",
      title: "Run",
      status: "completed",
      rawOutput: { exitCode: 0 },
    },
  ];
  for (const update of updates) {
    live.handleUpdate("test-session", update);
    replay.handleUpdate(update);
  }
  const [turn] = replay.turns;
  expect(turn.text).toBe(live.text);
  expect(turn.tools.map((tool) => tool.detail)).toEqual(
    events.filter(({ event }) => event === "tool-result").map(({ data }) => data.output),
  );
});
