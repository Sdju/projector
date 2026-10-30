import { expect, test, vi, afterEach } from "vite-plus/test";
import { createState, chatHistory } from "../src/modules/agent/model/chat-state.ts";
import { useChatActions } from "../src/modules/agent/model/chat-actions.ts";
import { applyAgentEvent } from "../src/modules/agent/model/turn-events.ts";
import { injectMessage } from "../server/modules/agent/injection.ts";
import { createTurnInput } from "../server/modules/agents/projector/projector-input.ts";
import { projectorBackend } from "../server/modules/agents/projector/index.ts";
import { scriptedModel } from "./evals/harness.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

afterEach(() => vi.unstubAllGlobals());

const message = (id, parts = []) => ({ id, text: id, parts });
function setup() {
  const state = createState();
  state.busy = true;
  state.activeMessage = "turn";
  state.capabilities = { inject: true };
  state.turns = [{ id: "answer", role: "assistant", text: "", tools: [] }];
  const send = vi.fn();
  const actions = useChatActions(state, {
    backend: "projector",
    projectId: "p",
    ready: Promise.resolve(),
    persist() {},
    send,
    stop() {},
  });
  return { state, actions, send };
}

test("automatic delivery is FIFO, waits for consumption, and does not duplicate concurrent requests", async () => {
  const { state, actions } = setup();
  const input = createTurnInput({
    messageId: "turn",
    emit: (event, data) => applyAgentEvent(state, state.turns[0], { event, data }, () => {}),
  });
  vi.stubGlobal("fetch", async (_, request) => {
    const { messageId, text } = JSON.parse(request.body);
    return new Response(null, { status: (await injectMessage(messageId, text)) ? 200 : 410 });
  });
  try {
    state.queue = [message("one"), message("two")];
    const sending = actions.deliverQueue();
    await actions.deliverQueue();
    expect(state.queue[0].delivering).toBe(true);
    actions.removeQueued("one");
    expect(state.queue).toHaveLength(2);
    expect(input.take().map((item) => item.content)).toEqual(["one"]);
    await vi.waitFor(() => expect(input.pending).toBe(true));
    expect(input.take().map((item) => item.content)).toEqual(["two"]);
    await sending;
    expect(state.queue).toEqual([]);
    expect(state.turns[0].parts).toEqual([
      { type: "note", text: "one" },
      { type: "note", text: "two" },
    ]);
  } finally {
    input.close();
  }
});

test("a closed or aborted turn leaves additions for the next answer", async () => {
  const { state, actions, send } = setup();
  const input = createTurnInput({ messageId: "turn", emit() {} });
  vi.stubGlobal("fetch", async (_, request) => {
    const { messageId, text } = JSON.parse(request.body);
    return new Response(null, { status: (await injectMessage(messageId, text)) ? 200 : 410 });
  });
  state.queue = [message("one")];
  const sending = actions.deliverQueue();
  state.busy = false;
  const draining = actions.drainQueue(false);
  input.close();
  await Promise.all([sending, draining]);
  expect(send).toHaveBeenCalledExactlyOnceWith("one", []);
  expect(await injectMessage("turn", "late")).toBe(false);
});

test("images keep their payload and block later text from overtaking them", async () => {
  const { state, actions } = setup();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  state.queue = [message("image", [{ type: "image", id: "pic" }]), message("two")];
  await actions.deliverQueue();
  expect(fetch).not.toHaveBeenCalled();
  expect(state.queue.map((item) => item.id)).toEqual(["image", "two"]);
});

test("replayed live additions remain user instructions between tool results and later text", () => {
  const turns = [
    {
      id: "a",
      role: "assistant",
      text: "beforeafter",
      tools: [{ id: "call", name: "bash", status: "done", detail: "ok" }],
      parts: [
        { type: "text", text: "before" },
        { type: "tool", id: "call" },
        { type: "note", text: "change direction" },
        { type: "text", text: "after" },
      ],
    },
  ];
  expect(chatHistory(turns, true)).toEqual([
    { role: "assistant", content: "before", tools: [{ id: "call", name: "bash", output: "ok" }] },
    { role: "user", content: "change direction" },
    { role: "assistant", content: "after" },
  ]);
});

test("real model loop consumes additions after tool results and after a final text chunk", async () => {
  const directory = await mkdtemp(join(tmpdir(), "projector-queue-"));
  const model = await scriptedModel([
    { tool: "list_commands", args: {} },
    { text: "initial" },
    { text: "updated" },
  ]);
  const old = Object.fromEntries(
    ["XDG_DATA_HOME", "OPENAI_URL", "OPENAI_API_KEY", "OPENAI_MODEL"].map((key) => [
      key,
      process.env[key],
    ]),
  );
  Object.assign(process.env, {
    XDG_DATA_HOME: directory,
    OPENAI_URL: model.url,
    OPENAI_API_KEY: "test",
    OPENAI_MODEL: "test",
  });
  const requests = [];
  const originalFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (url, init) => {
    if (String(url).startsWith(model.url)) requests.push(JSON.parse(init.body));
    return originalFetch(url, init);
  });
  const events = [];
  const additions = [];
  let pendingDuringTool = false;
  try {
    await projectorBackend.run({
      message: "start",
      messageId: "loop",
      cwd: directory,
      commands: async () => {
        additions.push(injectMessage("loop", "after the tool"));
        pendingDuringTool = !events.some((item) => item.event === "input");
        return { commands: [] };
      },
      emit(event, data) {
        events.push({ event, data });
        if (event === "text" && data.text === "initial")
          additions.push(injectMessage("loop", "after the text"));
      },
    });
    expect(await Promise.all(additions)).toEqual([true, true]);
    expect(requests).toHaveLength(3);
    expect(requests[1].messages.at(-1)).toMatchObject({ role: "user", content: "after the tool" });
    expect(requests[1].messages.at(-2).role).toBe("tool");
    expect(requests[2].messages.at(-1)).toMatchObject({ role: "user", content: "after the text" });
    expect(requests[2].messages.at(-2)).toMatchObject({ role: "assistant", content: "initial" });
    expect(pendingDuringTool).toBe(true);
    expect(events.filter((item) => item.event === "input").map((item) => item.data.text)).toEqual([
      "after the tool",
      "after the text",
    ]);
    expect(events.findIndex((item) => item.event === "tool-result")).toBeLessThan(
      events.findIndex((item) => item.event === "input"),
    );
    expect(events.filter((item) => item.event === "done")).toHaveLength(1);
    expect(events.at(-1).data.text).toBe("initialupdated");
    expect(await injectMessage("loop", "too late")).toBe(false);
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await model.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("hosted delivery waits for the runner's boundary acknowledgement", async () => {
  const { createRun, removeRun } = await import("../server/modules/agent/agent-runs.ts");
  const { runHostedAgent } = await import("../server/modules/agent/hosted-run.ts");
  const { writeFile } = await import("node:fs/promises");
  const directory = await mkdtemp(join(tmpdir(), "projector-queue-host-"));
  const record = { backend: "projector", message: "start", history: [], messageId: "hosted-input" };
  const id = await createRun(record);
  const abort = new AbortController();
  let active;
  try {
    const runner = join(directory, "runner.mjs");
    const modulePath = (path) => JSON.stringify(new URL(path, import.meta.url).href);
    await writeFile(
      runner,
      `
      import { runHostedRunner } from ${modulePath("../server/modules/agent/hosted-runner.ts")};
      import { createTurnInput } from ${modulePath("../server/modules/agents/projector/projector-input.ts")};
      runHostedRunner(async (options) => {
        const input = createTurnInput(options);
        options.emit("text", { text: "ready" });
        try {
          while (!input.pending && !options.abort.aborted) await new Promise(r => setTimeout(r, 10));
          await new Promise(r => setTimeout(r, 100));
          input.take();
          options.emit("done", { text: "done" });
        } finally { input.close(); }
      });
    `,
    );
    let ready;
    const started = new Promise((resolve) => (ready = resolve));
    const events = [];
    active = runHostedAgent(
      {
        ...record,
        abort: abort.signal,
        emit(event, data) {
          events.push({ event, data });
          if (event === "text") ready();
        },
      },
      { id, attach: false },
      { runner, cwd: directory, env: process.env },
      record.messageId,
    );
    await started;
    let accepted = false;
    const delivered = Promise.resolve(injectMessage(record.messageId, "follow-up")).then(
      (value) => (accepted = value),
    );
    expect(accepted).toBe(false);
    await delivered;
    expect(accepted).toBe(true);
    await active;
    expect(events.filter((item) => item.event === "input")).toEqual([
      { event: "input", data: { text: "follow-up" } },
    ]);
    expect(await injectMessage(record.messageId, "late")).toBe(false);
  } finally {
    abort.abort();
    await active;
    await removeRun(id);
    await rm(directory, { recursive: true, force: true });
  }
});

test("abort rejects unconsumed instructions instead of acknowledging or emitting them", async () => {
  const abort = new AbortController();
  const emit = vi.fn();
  const input = createTurnInput({ messageId: "aborting", abort: abort.signal, emit });
  const delivery = injectMessage("aborting", "keep this");
  abort.abort();
  expect(input.take()).toEqual([]);
  input.close();
  expect(await delivery).toBe(false);
  expect(emit).not.toHaveBeenCalled();
});

test("adding instructions does not reset the turn's loop budget", async () => {
  const directory = await mkdtemp(join(tmpdir(), "projector-queue-budget-"));
  const model = await scriptedModel([{ tool: "list_commands", args: {} }]);
  const old = Object.fromEntries(
    ["XDG_DATA_HOME", "OPENAI_URL", "OPENAI_API_KEY", "OPENAI_MODEL"].map((key) => [
      key,
      process.env[key],
    ]),
  );
  Object.assign(process.env, {
    XDG_DATA_HOME: directory,
    OPENAI_URL: model.url,
    OPENAI_API_KEY: "test",
    OPENAI_MODEL: "test",
  });
  const events = [];
  const additions = [];
  try {
    await projectorBackend.run({
      message: "start",
      messageId: "limited",
      cwd: directory,
      commands: async () => {
        additions.push(injectMessage("limited", `update ${additions.length}`));
        return { commands: [] };
      },
      emit(event, data) {
        events.push({ event, data });
      },
    });
    expect(await Promise.all(additions)).toEqual([true, true, false]);
    expect(events.at(-1)).toMatchObject({ event: "done", data: { stopped: "loop" } });
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await model.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("retrying the same queued instruction acknowledges it without delivering it twice", async () => {
  const emit = vi.fn();
  const input = createTurnInput({ messageId: "reconnect", emit });
  try {
    const first = injectMessage("reconnect", "do this", "queued-id");
    const retry = injectMessage("reconnect", "do this", "queued-id");
    expect(input.take()).toEqual([{ role: "user", content: "do this" }]);
    expect(await first).toBe(true);
    expect(await retry).toBe(true);
    expect(await injectMessage("reconnect", "do this", "queued-id")).toBe(true);
    expect(await injectMessage("reconnect", "other", "queued-id")).toBe(false);
    expect(input.pending).toBe(false);
    expect(emit).toHaveBeenCalledExactlyOnceWith("input", {
      text: "do this",
      inputId: "queued-id",
    });
  } finally {
    input.close();
  }
});

test("a replayed input confirms delivery even when the HTTP acknowledgement was lost", () => {
  const { state } = setup();
  state.queue = [message("confirmed"), message("next")];
  applyAgentEvent(
    state,
    state.turns[0],
    { event: "input", data: { text: "confirmed", inputId: "confirmed" } },
    () => {},
  );
  expect(state.queue.map((item) => item.id)).toEqual(["next"]);
  expect(state.turns[0].parts).toEqual([{ type: "note", text: "confirmed" }]);
});
