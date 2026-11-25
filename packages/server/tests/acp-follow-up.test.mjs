import { EventEmitter } from "node:events";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { expect, test, vi } from "vite-plus/test";
import { createAcpConnection } from "../modules/agents/acp/acp-client.ts";
import { settleAcpAnswer } from "../modules/agents/acp/acp-follow-up.ts";
import { createAcpEventMapper } from "../modules/agents/acp/acp-events.ts";
import { createPlainDialect } from "../modules/agents/acp/acp-dialect.ts";
import { decidePermission } from "../modules/agents/acp/acp-permission.ts";
import { createKimiDialect } from "../modules/agents/kimi/dialect.ts";
import { prepareKimiFollowUp } from "../modules/agents/kimi/follow-up.ts";
import {
  prepareOpenCodeFollowUp,
  watchOpenCodeFollowUp,
} from "../modules/agents/opencode/sessions.ts";

function answer(overrides = {}) {
  return {
    finish: vi.fn(),
    waitBackground: vi.fn(async () => {}),
    pollBackground: vi.fn(() => 0),
    text: "Начальный ответ.",
    pendingBackground: 0,
    keepsProcess: false,
    hadBackground: false,
    ...overrides,
  };
}
const program = { label: "OpenCode" };
function setup(subject, wait, options = {}) {
  const events = [];
  const result = settleAcpAnswer({
    answer: subject,
    program,
    followUp: { acceptsUpdates: () => true, wait },
    options: { emit: (event, data) => events.push([event, data]), ...options },
  });
  return { result, events };
}

test("continuation keeps the run open and emits one done with the full answer", async () => {
  const subject = answer({ hadBackground: true });
  let finish;
  const wait = vi.fn(async (options) => {
    options.onStart();
    await new Promise((resolve) => {
      finish = resolve;
    });
    subject.text += " Продолжение.";
    return { status: "completed" };
  });
  const { result, events } = setup(subject, wait);
  expect(events.map(([event]) => event)).toEqual(["status"]);
  finish();
  expect(await result).toBe(true);
  expect(events.filter(([event]) => event === "done")).toEqual([
    ["done", { text: "Начальный ответ. Продолжение.", added: [] }],
  ]);
});

test("without hard background work the answer closes as before", async () => {
  const wait = vi.fn();
  const { result, events } = setup(answer(), wait);
  expect(await result).toBe(false);
  expect(wait).not.toHaveBeenCalled();
  expect(events.map(([event]) => event)).toEqual(["done"]);
});

test.each([false, true])(
  "Kimi emits the final done only after the background wait (disconnected: %s)",
  async (disconnect) => {
    const events = [];
    const connection = new AbortController();
    let finish;
    const subject = answer({
      pendingBackground: 1,
      waitBackground: (signal) =>
        new Promise((resolve) => {
          finish = resolve;
          signal.addEventListener("abort", resolve, { once: true });
        }),
    });
    const result = settleAcpAnswer({
      answer: subject,
      program: { label: "Kimi", finishAfterBackground: true },
      disconnected: connection.signal,
      options: { emit: (event) => events.push(event) },
    });
    expect(events).toEqual(["status"]);
    if (disconnect) {
      connection.abort(new Error("ACP disconnected"));
      await expect(result).rejects.toThrow("ACP disconnected");
      expect(events).toEqual(["status"]);
    } else {
      finish();
      expect(await result).toBe(false);
      expect(events).toEqual(["status", "done"]);
    }
  },
);

test.each(["timeout", "unavailable", "failed"])(
  "%s is reported as error, never done",
  async (status) => {
    const { result, events } = setup(answer({ hadBackground: true }), async () => ({
      status,
      error: "observer error",
    }));
    expect(await result).toBe(true);
    expect(events).toEqual([["error", { error: "observer error" }]]);
  },
);

test("aborted observation emits no success", async () => {
  const { result, events } = setup(answer({ hadBackground: true }), async () => ({
    status: "aborted",
  }));
  expect(await result).toBe(true);
  expect(events).toEqual([]);
});

test("losing the ACP connection during a continuation emits an error", async () => {
  const disconnected = new AbortController();
  const emit = vi.fn();
  const result = settleAcpAnswer({
    answer: answer({ hadBackground: true }),
    program,
    followUp: {
      wait: ({ signal }) =>
        new Promise((resolve) =>
          signal.addEventListener("abort", () => resolve({ status: "aborted" }), { once: true }),
        ),
    },
    disconnected: disconnected.signal,
    options: { emit },
  });
  disconnected.abort();
  await expect(result).resolves.toBe(true);
  expect(emit.mock.calls.map(([event]) => event)).toEqual(["error"]);
});

test("a missing keep-alive marker is visible, never silent success", async () => {
  const wait = vi.fn();
  const { result, events } = setup(answer({ hadBackground: true }), wait, {
    run: { id: "bad run" },
  });
  expect(await result).toBe(true);
  expect(wait).not.toHaveBeenCalled();
  expect(events.map(([event]) => event)).toEqual(["error"]);
});

test("a second background child is polled and holds the same answer until its report", async () => {
  vi.useFakeTimers();
  try {
    const events = [];
    const emit = (event, data) => events.push([event, data]);
    let patches = [];
    const dialect = {
      ...createPlainDialect(),
      call: () => [{ id: "first", status: "running", background: true }],
      poll: () => patches.splice(0),
    };
    const mapper = createAcpEventMapper(emit, "OpenCode", dialect);
    mapper.handleUpdate("main", {
      sessionUpdate: "tool_call",
      toolCallId: "first",
      title: "subagent",
      status: "in_progress",
    });
    expect(mapper.pendingBackground).toBe(1);
    let state = { last: "idle", seq: 3, idle: 3, user: 1, firstUser: 1, interrupted: false };
    const result = settleAcpAnswer({
      answer: mapper,
      program,
      followUp: {
        acceptsUpdates: () => true,
        wait: (options) =>
          watchOpenCodeFollowUp("main", {
            ...options,
            read: () => state,
            intervalMs: 10,
            quietMs: 20,
            startMs: 30,
            totalMs: 1000,
          }),
      },
      options: { emit },
    });
    patches = [{ id: "first", status: "done" }];
    state = { ...state, last: "assistant", seq: 5 };
    await vi.advanceTimersByTimeAsync(10);
    patches = [{ id: "second", status: "running", background: true }];
    state = { ...state, last: "idle", seq: 6, idle: 6 };
    await vi.advanceTimersByTimeAsync(100);
    expect(mapper.pendingBackground).toBe(1);
    expect(events.some(([event]) => event === "done")).toBe(false);
    patches = [{ id: "second", status: "done" }];
    state = { ...state, last: "assistant", seq: 8 };
    await vi.advanceTimersByTimeAsync(10);
    mapper.handleUpdate("main", {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Оба отчёта получены." },
    });
    state = { ...state, last: "idle", seq: 9, idle: 9 };
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toBe(true);
    expect(mapper.pendingBackground).toBe(0);
    expect(events.filter(([event]) => event === "done")).toEqual([
      ["done", { text: "Оба отчёта получены.", added: [] }],
    ]);
  } finally {
    vi.useRealTimers();
  }
});

test("streamed continuation and outstanding permission keep the connection open after the final child", async () => {
  vi.useFakeTimers();
  try {
    const events = [];
    const emit = (event, data) => events.push([event, data]);
    let patches = [];
    const dialect = {
      ...createPlainDialect(),
      call: () => [{ id: "child", status: "running", background: true }],
      poll: () => patches.splice(0),
    };
    const mapper = createAcpEventMapper(emit, "OpenCode", dialect);
    mapper.handleUpdate("main", {
      sessionUpdate: "tool_call",
      toolCallId: "child",
      title: "subagent",
      status: "in_progress",
    });
    let state = { last: "idle", seq: 0, idle: 0, user: 0, firstUser: 0, interrupted: false };
    const followUp = prepareOpenCodeFollowUp("main", () => state);
    state = { ...state, last: "assistant", seq: 5, idle: 3, user: 1, firstUser: 1 };
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      detach: vi.fn(),
    });
    const replies = [];
    child.stdin.on("data", (chunk) => replies.push(JSON.parse(chunk.toString())));
    let approve;
    const connection = createAcpConnection(child, {
      onNotification(_method, { sessionId, update }) {
        if (followUp.acceptsUpdates(sessionId, update)) mapper.handleUpdate(sessionId, update);
      },
      onRequest: (_method, params) =>
        decidePermission(
          {
            approve: () =>
              new Promise((resolve) => {
                approve = resolve;
              }),
          },
          params,
        ),
    });
    const receive = (message) => child.stdout.write(JSON.stringify(message) + "\n");
    const chunk = (value) =>
      receive({
        method: "session/update",
        params: {
          sessionId: "main",
          update: {
            sessionUpdate: "agent_message_chunk",
            messageId: "parent",
            content: { type: "text", text: value },
          },
        },
      });
    const result = settleAcpAnswer({
      answer: mapper,
      program,
      followUp,
      disconnected: connection.disconnected,
      incomingActivity: connection.incomingActivity,
      options: { emit },
    }).then(async (keepProcess) => {
      await connection.close({ stop: !keepProcess });
      return keepProcess;
    });
    const done = () => events.filter(([event]) => event === "done");
    patches = [{ id: "child", status: "done" }];
    await vi.advanceTimersByTimeAsync(4900);
    chunk("Первая часть. ");
    await vi.advanceTimersByTimeAsync(800);
    chunk("Вторая часть. ");
    await vi.advanceTimersByTimeAsync(2400);
    expect(done()).toEqual([]);
    receive({
      id: 7,
      method: "session/request_permission",
      params: { options: [{ kind: "allow_once", optionId: "allow" }] },
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(done()).toEqual([]);
    expect(child.detach).not.toHaveBeenCalled();

    const outcome = { outcome: { outcome: "selected", optionId: "allow" } };
    approve(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(replies).toEqual([{ jsonrpc: "2.0", id: 7, result: outcome }]);
    expect(done()).toEqual([]);
    chunk("Готово.");
    await vi.advanceTimersByTimeAsync(4000);
    expect(await result).toBe(true);
    expect(child.detach).toHaveBeenCalledOnce();
    expect(done()).toEqual([["done", { text: "Первая часть. Вторая часть. Готово.", added: [] }]]);
    expect(events.some(([event]) => event === "error")).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

test("Kimi follow-up streams notify turn from wire.jsonl after WaitFor handoff and closes exclusive session", async () => {
  const home = await mkdtemp(join(tmpdir(), "projector-kimi-followup-"));
  try {
    const agentDir = join(home, ".kimi-code/sessions/wd_test/session_k1/agents/main");
    await mkdir(agentDir, { recursive: true });
    const wire = join(agentDir, "wire.jsonl");
    await writeFile(
      wire,
      `${JSON.stringify({ type: "turn.prompt", turnId: 6, trigger: "normal" })}\n`,
    );

    const events = [];
    const emit = (event, data) => events.push([event, data]);
    const mapper = createAcpEventMapper(emit, "Kimi", createKimiDialect(), {
      sessionId: () => "session_k1",
    });
    const followUp = prepareKimiFollowUp("session_k1", {
      home,
      intervalMs: 10,
      startMs: 500,
      quietMs: 30,
      totalMs: 2000,
    });

    mapper.handleUpdate("session_k1", {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Запускаю проверку. " },
    });
    mapper.handleUpdate("session_k1", {
      sessionUpdate: "tool_call",
      toolCallId: "6:b1",
      title: "Bash",
      kind: "execute",
      status: "in_progress",
      rawInput: { command: "vp run check", run_in_background: true, description: "Gate" },
    });
    mapper.handleUpdate("session_k1", {
      sessionUpdate: "tool_call_update",
      toolCallId: "6:b1",
      status: "completed",
      content: [
        {
          type: "content",
          content: {
            type: "text",
            text: "task_id: bash-1\npid: 10\ndescription: Gate\nstatus: running\nautomatic_notification: true\n",
          },
        },
      ],
    });
    mapper.handleUpdate("session_k1", {
      sessionUpdate: "tool_call",
      toolCallId: "6:w1",
      title: "WaitFor",
      kind: "other",
      status: "in_progress",
      rawInput: { task_id: "bash-1", timeout: 90 },
    });
    mapper.handleUpdate("session_k1", {
      sessionUpdate: "tool_call_update",
      toolCallId: "6:w1",
      status: "completed",
      content: [
        {
          type: "content",
          content: {
            type: "text",
            text: "wait_status: completed\ntask_id: bash-1\nstatus: completed\nexit_code: 0\n",
          },
        },
      ],
    });

    const settled = settleAcpAnswer({
      answer: mapper,
      program: { label: "Kimi", exclusiveSession: true, finishAfterBackground: true },
      followUp,
      onUpdate: (update) => mapper.handleUpdate("session_k1", update),
      options: { emit },
    });

    await appendFile(
      wire,
      [
        JSON.stringify({ type: "turn.prompt", turnId: 7, trigger: "notify" }),
        JSON.stringify({
          type: "context.append_loop_event",
          event: { type: "content.part", part: { type: "think", think: "Now commit." } },
        }),
        JSON.stringify({
          type: "context.append_loop_event",
          event: {
            type: "tool.call",
            turnId: "7",
            toolCallId: "tool_commit",
            name: "Bash",
            args: { command: "git commit -m fix" },
            display: { description: "Git commit" },
          },
        }),
        JSON.stringify({
          type: "context.append_loop_event",
          event: {
            type: "tool.result",
            toolCallId: "tool_commit",
            result: { output: "[master abc123] fix", isError: false },
          },
        }),
        JSON.stringify({
          type: "context.append_loop_event",
          event: { type: "content.part", part: { type: "text", text: "Закоммичено." } },
        }),
        JSON.stringify({ type: "turn.ended", turnId: 7, reason: "completed" }),
      ].join("\n") + "\n",
    );

    const keepProcess = await settled;
    expect(keepProcess).toBe(false);
    expect(events).toContainEqual(["thought", { text: "Now commit." }]);
    expect(events).toContainEqual([
      "tool-result",
      { id: "7:tool_commit", name: "Git commit", output: "[master abc123] fix" },
    ]);
    expect(events.filter(([event]) => event === "done")).toEqual([
      ["done", { text: "Запускаю проверку. Закоммичено.", added: [] }],
    ]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
