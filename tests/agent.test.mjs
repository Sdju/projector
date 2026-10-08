import { expect, test } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCommandBridge,
  completeCommandRequest,
  readAgentHistory,
  writeAgentHistory,
} from "../server/modules/agent/index.ts";
import { createAgentTools } from "../server/modules/agent/agent-tools.ts";
import { createCommandService } from "../core/modules/ide/index.ts";
import { agentCommandHandler } from "../src/modules/agent/model/commands.ts";
import { os } from "../core/modules/os/index.ts";

test("command bridge routes concurrent replies once, expires and cancels requests", async () => {
  const requests = [];
  const abort = new AbortController();
  const bridge = createCommandBridge((_, request) => requests.push(request), abort.signal, 20);
  const first = bridge({ operation: "list" });
  const second = bridge({ operation: "describe", command: "test", scope: "a" });
  expect(requests[0].id).not.toBe(requests[1].id);
  expect(completeCommandRequest(requests[1].id, { output: "second" })).toBe(true);
  expect(await second).toBe("second");
  expect(completeCommandRequest(requests[1].id, { output: "again" })).toBe(false);
  expect(completeCommandRequest(requests[0].id, { error: "failure" })).toBe(true);
  await expect(first).rejects.toThrow(/failure/);
  await expect(bridge({ operation: "list" })).rejects.toThrow(/не ответил/);
  const cancelled = bridge({ operation: "list" });
  abort.abort();
  await expect(cancelled).rejects.toThrow(/остановлен/);
  expect(completeCommandRequest(requests.at(-1).id, {})).toBe(false);
});

test("agent discovers live commands, requires description, checks args and excludes other projects", async () => {
  const sdk = createCommandService();
  const scope = sdk.createScope("tree", () => ({ projectId: "a", surface: "fileTree" }));
  let output;
  scope.registerCommand({
    id: "ide.fileTree.file.rename",
    title: "Rename",
    enabled: (args) => args?.path === "old.md",
    run: (args) => {
      output = args.name;
      return { destination: args.name };
    },
  });
  sdk
    .createScope("other", () => ({ projectId: "b" }))
    .registerCommand({ id: "secret", title: "Other", run: () => {} });
  const commands = agentCommandHandler(sdk, "a");
  const tools = createAgentTools({ onProject: () => {}, commands });
  const call = (name, input) => tools[name].execute(input, { toolCallId: "test", messages: [] });
  expect((await call("list_commands", {})).commands.map((c) => c.id)).toStrictEqual([
    "ide.fileTree.file.rename",
  ]);
  await expect(async () =>
    call("execute_command", { command: "ide.fileTree.file.rename", scope: "tree" }),
  ).rejects.toThrow(/Сначала/);
  const description = await call("describe_command", {
    command: "ide.fileTree.file.rename",
    scope: "tree",
  });
  expect(description.arguments.name).toBeTruthy();
  expect(description.enabled).toBe(false);
  await expect(
    call("execute_command", { command: description.id, scope: "tree", args: { path: "bad" } }),
  ).rejects.toThrow(/недоступна/);
  expect(
    await call("execute_command", {
      command: description.id,
      scope: "tree",
      args: { path: "old.md", name: "new.md" },
    }),
  ).toStrictEqual({ destination: "new.md" });
  expect(output).toBe("new.md");
  await expect(
    commands({ operation: "execute", scope: "other", command: "secret" }),
  ).rejects.toThrow(/недоступна/);
  scope.dispose();
  await expect(
    commands({ operation: "execute", scope: "tree", command: description.id }),
  ).rejects.toThrow(/недоступна/);
});

test("agent can navigate global settings but cannot access another project's settings scope", async () => {
  const sdk = createCommandService();
  const sectionCommand = {
    id: "ide.settings.section.open",
    title: "Настройки",
    run: (args) => args.id,
  };
  sdk.createScope("settings", () => ({ surface: "settings" })).registerCommand(sectionCommand);
  sdk
    .createScope("other-settings", () => ({ surface: "settings", projectId: "b" }))
    .registerCommand(sectionCommand);
  const commands = agentCommandHandler(sdk, "a");
  const listed = await commands({ operation: "list", query: "ide.settings" });
  expect(listed.commands.map((command) => command.scope)).toStrictEqual(["settings"]);
  expect(
    await commands({
      operation: "execute",
      scope: "settings",
      command: sectionCommand.id,
      args: { id: "editor" },
    }),
  ).toBe("editor");
  await expect(
    commands({
      operation: "execute",
      scope: "other-settings",
      command: sectionCommand.id,
      args: { id: "editor" },
    }),
  ).rejects.toThrow(/Область недоступна/);
});

test("Bash uses cwd, returns failure status, bounds output and aborts subprocesses", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "projector-agent-shell-"));
  try {
    const result = await os.tools.runBash(
      `${process.platform === "win32" ? "pwd -W" : "pwd"}; printf failure >&2; exit 7`,
      { cwd },
    );
    const printed =
      process.platform === "win32"
        ? result.stdout
            .trim()
            .replace(/^\/([A-Za-z])\//, (_, drive) => `${drive.toUpperCase()}:\\`)
            .replace(/\//g, "\\")
        : result.stdout.trim();
    expect(printed.toLowerCase()).toBe(cwd.toLowerCase());
    expect(result.stderr).toBe("failure");
    expect(result.exitCode).toBe(7);
    const bounded = await os.tools.runBash("yes agent", { cwd });
    expect(bounded.terminated).toBe(true);
    expect(Buffer.byteLength(bounded.stdout) <= 256 * 1024).toBeTruthy();
    const abort = new AbortController();
    const running = os.tools.runBash("sleep 100 & wait", { cwd, signal: abort.signal });
    setTimeout(() => abort.abort(), 30);
    await expect(running).rejects.toThrow(/остановлен/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("chat history persists on disk, validates data and separates project IDs", async () => {
  const previous = process.env.XDG_DATA_HOME;
  const directory = await mkdtemp(join(tmpdir(), "projector-agent-history-"));
  process.env.XDG_DATA_HOME = directory;
  try {
    const turns = [{ id: "one", role: "user", text: "hello", tools: [] }];
    await writeAgentHistory("a/../../b", turns);
    expect(await readAgentHistory("a/../../b")).toStrictEqual(turns);
    expect(await readAgentHistory("other")).toStrictEqual([]);
    await expect(writeAgentHistory("a", [{ role: "system" }])).rejects.toThrow();
    await writeAgentHistory("a/../../b", []);
    expect(await readAgentHistory("a/../../b")).toStrictEqual([]);
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("HTTP agent streams discovery, description, execution, Bash and final text through its SSE client", async () => {
  const { createServer } = await import("node:http");
  const { once } = await import("node:events");
  const { saveProviders } = await import("../server/modules/providers/index.ts");
  const { handleApi } = await import("../server/app/api.ts");
  const { streamAgent } = await import("../src/modules/agent/api/client.ts");
  const directory = await mkdtemp(join(tmpdir(), "projector-agent-http-"));
  const previousData = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
  const requests = [];
  const steps = [
    ["list_commands", { query: "test.command" }],
    ["describe_command", { command: "test.command", scope: "test" }],
    ["execute_command", { command: "test.command", scope: "test", args: { name: "worked" } }],
    ["bash", { command: "printf agent-shell-ok", cwd: directory }],
  ];
  const provider = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    const step = steps[requests.length - 1];
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const delta = step
      ? {
          tool_calls: [
            {
              index: 0,
              id: `tool-${requests.length}`,
              type: "function",
              function: { name: step[0], arguments: JSON.stringify(step[1]) },
            },
          ],
        }
      : { content: "agent-http-ok" };
    const event = (delta, finish_reason) =>
      `data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 1, model: "mock", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    res.end(event(delta, null) + event({}, step ? "tool_calls" : "stop") + "data: [DONE]\n\n");
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const server = createServer((req, res) => {
    void handleApi(req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const originalFetch = globalThis.fetch;
  try {
    await saveProviders({
      activeProviderId: "mock",
      providers: [
        {
          id: "mock",
          name: "Local mock",
          model: "mock",
          url: `http://127.0.0.1:${provider.address().port}`,
          apiKey: "test",
        },
      ],
    });
    globalThis.fetch = (url, init) =>
      originalFetch(typeof url === "string" && url.startsWith("/") ? base + url : url, init);
    const sdk = createCommandService();
    let executed = false;
    sdk
      .createScope("test", () => ({ projectId: "a" }))
      .registerCommand({
        id: "test.command",
        title: "Test",
        arguments: { name: "string" },
        run: ({ name }) => {
          executed = name === "worked";
          return { executed };
        },
      });
    const events = [];
    await streamAgent("Run local test", [], (event) => events.push(event), undefined, {
      commands: agentCommandHandler(sdk, "a"),
    });
    expect(executed).toBe(true);
    expect(requests.length).toBe(5);
    expect(events.filter((e) => e.event === "tool").map((e) => e.data.name)).toStrictEqual(
      steps.map((s) => s[0]),
    );
    expect(events.find((e) => e.event === "error")).toBe(undefined);
    expect(events.find((e) => e.event === "done").data.text).toBe("agent-http-ok");
    expect(
      events.find((e) => e.event === "tool-result" && e.data.name === "bash").data.output.stdout,
    ).toBe("agent-shell-ok");
    expect(
      requests
        .at(-1)
        .messages.some((m) => m.role === "tool" && m.content.includes("agent-shell-ok")),
    ).toBeTruthy();
    const rejected = await originalFetch(base + "/api/agent", {
      method: "POST",
      headers: { Origin: "https://foreign.example", "Content-Type": "application/json" },
      body: '{"message":"test"}',
    });
    expect(rejected.status).toBe(403);
    expect(
      (
        await originalFetch(base + "/api/agent/tool-result", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: '{"id":"expired"}',
        })
      ).status,
    ).toBe(410);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousData === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousData;
    server.closeAllConnections();
    provider.closeAllConnections();
    await Promise.all([new Promise((r) => server.close(r)), new Promise((r) => provider.close(r))]);
    await rm(directory, { recursive: true, force: true });
  }
});

test("approval bridge resolves only an explicit allow and cancels with the request", async () => {
  const { createApprovalBridge } = await import("../server/modules/agent/index.ts");
  const requests = [];
  const abort = new AbortController();
  const approve = createApprovalBridge((_, request) => requests.push(request), abort.signal, 20);
  const allowed = approve({ tool: "Edit", input: { file_path: "a" }, title: "Edit a" });
  expect(requests[0]).toMatchObject({ tool: "Edit", title: "Edit a" });
  expect(completeCommandRequest(requests[0].id, { output: { allow: true } })).toBe(true);
  expect(await allowed).toBe(true);
  const denied = approve({ tool: "Bash", input: {} });
  completeCommandRequest(requests[1].id, { output: { allow: "yes" } });
  expect(await denied).toBe(false);
  await expect(approve({ tool: "Bash", input: {} })).rejects.toThrow(/вовремя/);
  const cancelled = approve({ tool: "Bash", input: {} });
  abort.abort();
  await expect(cancelled).rejects.toThrow(/остановлен/);
});

test("Claude Code messages become the shared chat events", async () => {
  const { createClaudeEventMapper } = await import("../server/modules/agent/claude-code-events.ts");
  const events = [];
  const mapper = createClaudeEventMapper((event, data) => events.push([event, data]));
  const stream = (event, parent = null) => ({
    type: "stream_event",
    event,
    parent_tool_use_id: parent,
  });
  mapper.handle({ type: "system", subtype: "init", session_id: "s1", model: "claude-x" });
  mapper.handle(stream({ type: "message_start", message: { id: "m1" } }));
  mapper.handle(
    stream({ type: "content_block_delta", delta: { type: "text_delta", text: "Открываю" } }),
  );
  mapper.handle({
    type: "assistant",
    parent_tool_use_id: null,
    message: {
      id: "m1",
      content: [
        { type: "text", text: "Открываю" },
        {
          type: "tool_use",
          id: "t1",
          name: "Read",
          input: { file_path: "x" },
        },
      ],
    },
  });
  mapper.handle({
    type: "user",
    message: {
      content: [
        { type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "{}" }] },
        { type: "tool_result", tool_use_id: "t2", content: "boom", is_error: true },
      ],
    },
  });
  // Sub-agent text never becomes the answer; a message without deltas falls back to its blocks.
  mapper.handle(stream({ type: "message_start", message: { id: "sub" } }, "t1"));
  mapper.handle({
    type: "assistant",
    parent_tool_use_id: "t1",
    message: { id: "sub", content: [{ type: "text", text: "internal" }] },
  });
  mapper.handle({
    type: "assistant",
    parent_tool_use_id: null,
    message: { id: "m2", content: [{ type: "text", text: "Готово" }] },
  });
  mapper.handle({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Готово",
    total_cost_usd: 0.01,
  });
  expect(mapper.sessionId).toBe("s1");
  expect(events.map(([event]) => event)).toStrictEqual([
    "session",
    "status",
    "text",
    "tool",
    "tool-result",
    "tool-result",
    "text",
    "text",
    "done",
  ]);
  expect(events[3][1]).toStrictEqual({ id: "t1", name: "Read", input: { file_path: "x" } });
  expect(events[4][1]).toStrictEqual({ id: "t1", name: "Read", output: "{}" });
  expect(events[5][1]).toMatchObject({ id: "t2", error: "boom" });
  expect(
    events
      .filter(([event]) => event === "text")
      .map(([, data]) => data.text)
      .join(""),
  ).toBe("Открываю\n\nГотово");
  const failed = [];
  const failing = createClaudeEventMapper((event, data) => failed.push([event, data]));
  failing.handle({
    type: "result",
    subtype: "error_during_execution",
    is_error: true,
    errors: ["no session"],
  });
  expect(failing.failed).toBe(true);
  expect(failing.started).toBe(false);
  expect(failed[0]).toStrictEqual(["error", { error: "no session" }]);
});

test("ACP session updates become the shared chat events", async () => {
  const { createAcpEventMapper } = await import("../server/modules/agent/acp-events.ts");
  const events = [];
  const mapper = createAcpEventMapper((event, data) => events.push([event, data]), "OpenCode");
  mapper.handleUpdate("s1", {
    sessionUpdate: "agent_thought_chunk",
    content: { type: "text", text: "думаю" },
  });
  mapper.handleUpdate("s1", {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "Открываю" },
  });
  mapper.handleUpdate("s1", {
    sessionUpdate: "tool_call",
    toolCallId: "t1",
    title: "Read file",
    kind: "read",
    status: "pending",
    rawInput: { path: "x" },
  });
  mapper.handleUpdate("s1", {
    sessionUpdate: "tool_call_update",
    toolCallId: "t1",
    status: "completed",
    rawOutput: "ok",
  });
  mapper.handleUpdate("s1", {
    sessionUpdate: "tool_call",
    toolCallId: "t2",
    title: "Bash",
    kind: "execute",
    status: "failed",
    rawOutput: "boom",
  });
  mapper.handleUpdate("s1", {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: " Готово" },
  });
  expect(mapper.text).toBe("Открываю Готово");
  expect(events.map(([event]) => event)).toStrictEqual([
    "status",
    "text",
    "tool",
    "tool-result",
    "tool",
    "tool-result",
    "text",
  ]);
  expect(events[2][1]).toStrictEqual({
    id: "t1",
    name: "Read file",
    input: { path: "x" },
  });
  expect(events[3][1]).toStrictEqual({ id: "t1", name: "Read file", output: "ok" });
  expect(events[5][1]).toMatchObject({ id: "t2", error: "boom" });
});

test("ACP client frames JSON-RPC over a real child process", async () => {
  const { spawn } = await import("node:child_process");
  const { createAcpConnection } = await import("../server/modules/agent/acp-client.ts");
  const script = `
    const readline = require("node:readline");
    const rl = readline.createInterface({ input: process.stdin });
    const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
    rl.on("line", (line) => {
      const message = JSON.parse(line);
      if (message.method === "initialize")
        send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } });
      else if (message.method === "session/new")
        send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "s1" } });
      else if (message.method === "session/prompt") {
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "s1",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "hi" },
            },
          },
        });
        send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } });
      } else send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unknown" } });
    });
  `;
  const child = spawn(process.execPath, ["-e", script], { stdio: ["pipe", "pipe", "pipe"] });
  const updates = [];
  const connection = createAcpConnection(child, {
    onNotification: (method, params) => updates.push([method, params.update.sessionUpdate]),
    onRequest: () => ({}),
  });
  expect((await connection.request("initialize", {})).protocolVersion).toBe(1);
  const session = await connection.request("session/new", { cwd: "/tmp", mcpServers: [] });
  expect(session.sessionId).toBe("s1");
  const result = await connection.request("session/prompt", { sessionId: "s1", prompt: [] });
  expect(result.stopReason).toBe("end_turn");
  expect(updates).toStrictEqual([["session/update", "agent_message_chunk"]]);
  await connection.close();
});

test("stopping an agent kills its whole process tree", async () => {
  if (process.platform === "win32") return;
  const { os } = await import("../core/modules/os/index.ts");
  const { createAcpConnection } = await import("../server/modules/agent/acp-client.ts");
  const child = os.tools.spawnAgentProcess({
    command: process.execPath,
    args: [
      "-e",
      'const { spawn } = require("node:child_process"); const grandchild = spawn("sleep", ["300"]); process.stdout.write(String(grandchild.pid) + "\\n"); setInterval(() => {}, 1000);',
    ],
  });
  const pid = await new Promise((resolve) =>
    child.stdout.once("data", (chunk) => resolve(Number(String(chunk).trim()))),
  );
  const connection = createAcpConnection(child, { onNotification() {}, onRequest: () => ({}) });
  await connection.close();
  await new Promise((resolve) => setTimeout(resolve, 300));
  // The shell's grandchild must be gone, not only the agent process itself.
  expect(await os.processes.identity(pid)).toBe(null);
});

test("ACP permission prefers one-time options and previews the change", async () => {
  const { decidePermission, toolCallDetail } =
    await import("../server/modules/agent/acp-backend.ts");
  const capture = (answer) => {
    const state = { request: undefined };
    return {
      state,
      options: {
        approve: async (request) => {
          state.request = request;
          return answer;
        },
      },
    };
  };
  // allow_always/reject_always come first: a plain allow/deny must still pick the one-time option.
  const options = [
    { optionId: "a-always", kind: "allow_always" },
    { optionId: "a-once", kind: "allow_once" },
    { optionId: "r-always", kind: "reject_always" },
    { optionId: "r-once", kind: "reject_once" },
  ];
  const toolCall = { title: "Edit src/a.ts", rawInput: {} };

  const allow = capture(true);
  expect(await decidePermission(allow.options, { toolCall, options })).toStrictEqual({
    outcome: { outcome: "selected", optionId: "a-once" },
  });
  expect(allow.state.request.persistent).toBe(true);

  const always = capture("always");
  expect(await decidePermission(always.options, { toolCall, options })).toStrictEqual({
    outcome: { outcome: "selected", optionId: "a-always" },
  });

  const deny = capture(false);
  expect(await decidePermission(deny.options, { toolCall, options })).toStrictEqual({
    outcome: { outcome: "selected", optionId: "r-once" },
  });

  const detail = toolCallDetail({
    content: [
      { type: "diff", path: "src/a.ts", oldText: "old", newText: "new" },
      { type: "content", content: { type: "text", text: "контекст" } },
    ],
  });
  expect(detail).toContain("--- src/a.ts");
  expect(detail).toContain("-old");
  expect(detail).toContain("+new");
  expect(detail).toContain("контекст");
});

test("approval bridge turns an always answer into a durable choice", async () => {
  const { createApprovalBridge } = await import("../server/modules/agent/index.ts");
  const requests = [];
  const abort = new AbortController();
  const approve = createApprovalBridge((_, request) => requests.push(request), abort.signal, 20);
  const always = approve({ tool: "Edit", input: {}, persistent: true });
  expect(requests[0]).toMatchObject({ tool: "Edit", persistent: true });
  expect(completeCommandRequest(requests[0].id, { output: { allow: true, always: true } })).toBe(
    true,
  );
  expect(await always).toBe("always");
  const once = approve({ tool: "Edit", input: {} });
  completeCommandRequest(requests[1].id, { output: { allow: true } });
  expect(await once).toBe(true);
});

test("ACP resume keeps the requested session, replays history only on a fresh one", async () => {
  const { openSession } = await import("../server/modules/agent/acp-backend.ts");
  const calls = [];
  const replay = [];
  const loading = {
    request: async (method) => {
      calls.push(method);
      return method === "session/load" ? {} : { sessionId: "new-1" };
    },
  };
  const resumed = await openSession(loading, { sessionId: "old-1", cwd: "/tmp" }, [], (active) =>
    replay.push(active),
  );
  // The ACP load response has no sessionId: the requested one must survive.
  expect(resumed).toMatchObject({ sessionId: "old-1", resumed: true });
  expect(calls).toStrictEqual(["session/load"]);
  expect(replay).toStrictEqual([true, false]);

  const failed = {
    request: async (method) => {
      if (method === "session/load") throw new Error("no such session");
      return { sessionId: "new-2" };
    },
  };
  expect(
    await openSession(failed, { sessionId: "old-1", cwd: "/tmp" }, [], () => {}),
  ).toMatchObject({ sessionId: "new-2", resumed: false });
});

test("ACP session open does not mask real failures as a missing session", async () => {
  const { openSession } = await import("../server/modules/agent/acp-backend.ts");
  const options = { sessionId: "old-1", cwd: "/tmp" };

  // No loadSession capability: go straight to a fresh session without trying to load.
  const calls = [];
  const noLoad = {
    request: async (method) => {
      calls.push(method);
      return { sessionId: "n" };
    },
  };
  await openSession(noLoad, options, [], () => {}, false);
  expect(calls).toStrictEqual(["session/new"]);

  // A dead connection is reported as is, not retried with session/new.
  const dead = [];
  const fatal = Object.assign(new Error("Агент завершился до ответа: boom"), { fatal: true });
  const broken = {
    request: async (method) => {
      dead.push(method);
      throw fatal;
    },
  };
  await expect(openSession(broken, options, [], () => {})).rejects.toBe(fatal);
  expect(dead).toStrictEqual(["session/load"]);

  // A missing login on load goes through authenticate, then the session is resumed.
  const steps = [];
  let authed = false;
  const login = {
    request: async (method) => {
      steps.push(method);
      if (method === "authenticate") authed = true;
      if (method === "session/load" && !authed) throw new Error("Authentication required");
      return method === "session/new" ? { sessionId: "x" } : {};
    },
  };
  expect(await openSession(login, options, [{ id: "m" }], () => {})).toMatchObject({
    sessionId: "old-1",
    resumed: true,
  });
  expect(steps).toStrictEqual(["session/load", "authenticate", "session/load"]);
});

test("ACP client times out silent requests but not when disabled", async () => {
  const { spawn } = await import("node:child_process");
  const { createAcpConnection, NO_TIMEOUT } = await import("../server/modules/agent/acp-client.ts");
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const connection = createAcpConnection(child, { onNotification() {}, onRequest: () => ({}) });
  const silent = connection.request("initialize", {}, 50);
  await expect(silent).rejects.toMatchObject({ fatal: true, message: /не ответил/ });
  const waiting = connection.request("session/prompt", {}, NO_TIMEOUT);
  const outcome = await Promise.race([
    waiting.then(
      () => "answered",
      () => "failed",
    ),
    new Promise((resolve) => setTimeout(() => resolve("waiting"), 200)),
  ]);
  expect(outcome).toBe("waiting");
  await connection.close();
  await expect(waiting).rejects.toThrow();
});

test("agent processes resolve programs through the interactive shell PATH", async () => {
  if (process.platform === "win32") return;
  const { mkdtemp, writeFile, chmod } = await import("node:fs/promises");
  const { os } = await import("../core/modules/os/index.ts");
  const dir = await mkdtemp(join(tmpdir(), "projector-shell-path-"));
  await writeFile(join(dir, "fake-agent"), "#!/bin/sh\n");
  await chmod(join(dir, "fake-agent"), 0o755);
  // A throwaway shell whose rc adds a directory, like ~/.bashrc adds ~/.opencode/bin.
  const shellPath = join(dir, "fake-shell");
  await writeFile(shellPath, `#!/bin/sh\nPATH="$PATH:${dir}" exec /bin/sh -c "$3"\n`);
  await chmod(shellPath, 0o755);
  const previous = process.env.SHELL;
  process.env.SHELL = shellPath;
  try {
    const base = { PATH: "/usr/bin:/bin" };
    expect(os.tools.commandExists("fake-agent", base)).toBe(false);
    const env = await os.tools.agentEnv(base);
    expect(env.PATH.split(":")).toContain(dir);
    expect(env.PATH.startsWith("/usr/bin:/bin")).toBe(true);
    expect(os.tools.commandExists("fake-agent", env)).toBe(true);
  } finally {
    if (previous === undefined) delete process.env.SHELL;
    else process.env.SHELL = previous;
  }
});

const codexSession = {
  sessionId: "s1",
  models: {
    currentModelId: "gpt-6.1-sol[medium]",
    availableModels: [{ modelId: "gpt-6.1-sol[medium]", name: "Sol (medium)" }],
  },
  modes: {
    currentModeId: "agent",
    availableModes: [
      { id: "agent", name: "Auto review" },
      { id: "read-only", name: "Read-only", description: "Asks first" },
    ],
  },
  configOptions: [
    {
      id: "mode",
      name: "Mode",
      category: "mode",
      type: "select",
      currentValue: "agent",
      options: [
        { value: "agent", name: "Auto review" },
        { value: "read-only", name: "Read-only" },
      ],
    },
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "gpt-6.1-sol",
      options: [
        { value: "gpt-6.1-sol", name: "Sol" },
        { group: "older", name: "Older", options: [{ value: "gpt-6-luna", name: "Luna" }] },
      ],
    },
    {
      id: "reasoning_effort",
      name: "Effort",
      category: "thought_level",
      type: "select",
      currentValue: "medium",
      options: [
        { value: "low", name: "Low" },
        { value: "medium", name: "Medium" },
      ],
    },
    { id: "fast", name: "Fast", category: "model_config", type: "boolean", currentValue: false },
    {
      id: "collab",
      name: "Collab",
      category: "collaboration_mode",
      type: "select",
      currentValue: "default",
      options: [{ value: "default", name: "Default" }],
    },
  ],
};

test("ACP controls: model, effort, mode first; config options win over the legacy lists", async () => {
  const { controlsFromSession } = await import("../server/modules/agent/acp-controls.ts");
  const controls = controlsFromSession(codexSession);
  expect(controls.map((control) => [control.id, control.category])).toStrictEqual([
    ["model", "model"],
    ["reasoning_effort", "effort"],
    ["mode", "mode"],
    ["collab", "other"],
  ]);
  // Grouped options are flattened, and the unsupported boolean option is skipped.
  expect(controls[0].options.map((option) => option.value)).toStrictEqual([
    "gpt-6.1-sol",
    "gpt-6-luna",
  ]);
  expect(controls.every((control) => control.via === "config")).toBe(true);

  // An agent that only reports the legacy lists still gets a model and a mode control.
  const legacy = controlsFromSession({ models: codexSession.models, modes: codexSession.modes });
  expect(legacy.map((control) => [control.id, control.via, control.current])).toStrictEqual([
    ["model", "model", "gpt-6.1-sol[medium]"],
    ["mode", "mode", "agent"],
  ]);
  expect(controlsFromSession(undefined)).toStrictEqual([]);
});

test("ACP selection is applied in order, re-reads dependent options and skips refusals", async () => {
  const { applySelection, controlsFromSession } =
    await import("../server/modules/agent/acp-controls.ts");
  const calls = [];
  let state = codexSession.configOptions;
  const connection = {
    request: async (method, params) => {
      calls.push([method, params.configId ?? params.modelId ?? params.modeId, params.value]);
      if (params.configId === "reasoning_effort") throw new Error("refused");
      state = state.map((option) => {
        if (option.id === params.configId) return { ...option, currentValue: params.value };
        // A new model brings its own effort levels.
        if (params.configId === "model" && option.id === "reasoning_effort")
          return { ...option, options: [{ value: "low", name: "Low" }], currentValue: "low" };
        return option;
      });
      return { configOptions: state };
    },
  };
  const controls = controlsFromSession(codexSession);
  const applied = await applySelection(connection, "s1", controls, {
    model: "gpt-6-luna",
    reasoning_effort: "low",
    mode: "read-only",
    collab: "default",
    unknown: "x",
  });
  // Model first; effort was refused and mode went through; same-value and unknown ids are skipped.
  expect(calls.map(([method, id]) => `${method}:${id}`)).toStrictEqual([
    "session/set_config_option:model",
    "session/set_config_option:mode",
  ]);
  const byId = Object.fromEntries(applied.map((control) => [control.id, control.current]));
  expect(byId).toMatchObject({ model: "gpt-6-luna", reasoning_effort: "low", mode: "read-only" });

  // A value the agent does not list is never sent.
  const none = [];
  await applySelection({ request: async (...args) => none.push(args) }, "s1", controls, {
    model: "not-a-model",
  });
  expect(none).toStrictEqual([]);

  // Legacy controls go through set_model / set_mode.
  const legacyCalls = [];
  const legacy = controlsFromSession({ models: codexSession.models, modes: codexSession.modes });
  await applySelection(
    { request: async (method, params) => legacyCalls.push([method, params]) },
    "s1",
    legacy,
    { mode: "read-only" },
  );
  expect(legacyCalls).toStrictEqual([
    ["session/set_mode", { sessionId: "s1", modeId: "read-only" }],
  ]);
});

test("ACP replay rebuilds the chat from a loaded session", async () => {
  const { createAcpReplayCollector } = await import("../server/modules/agent/acp-events.ts");
  const replay = createAcpReplayCollector("opencode", "ses_1");
  const chunk = (sessionUpdate, text) => ({ sessionUpdate, content: { type: "text", text } });
  replay.handleUpdate(chunk("user_message_chunk", "Создай "));
  replay.handleUpdate(chunk("user_message_chunk", "файл"));
  replay.handleUpdate(chunk("agent_message_chunk", "Создаю."));
  replay.handleUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "t1",
    title: "write",
    rawInput: { path: "a" },
  });
  replay.handleUpdate({
    sessionUpdate: "tool_call_update",
    toolCallId: "t1",
    status: "completed",
    rawOutput: "ok",
  });
  replay.handleUpdate(chunk("agent_message_chunk", ""));
  replay.handleUpdate(chunk("user_message_chunk", "Спасибо"));
  const turns = replay.turns;
  expect(turns.map((turn) => [turn.role, turn.text])).toStrictEqual([
    ["user", "Создай файл"],
    ["assistant", "Создаю."],
    ["user", "Спасибо"],
  ]);
  expect(turns[1].tools).toStrictEqual([{ id: "t1", name: "write", status: "done", detail: "ok" }]);
  // Only answers carry the native session, so the next message resumes it.
  expect(turns.map((turn) => turn.session?.id)).toStrictEqual([undefined, "ses_1", undefined]);
});

test("agent choices are stored per backend and validated", async () => {
  const { selectionFrom } = await import("../server/modules/agent/index.ts");
  expect(selectionFrom({ model: "opus", bad: 1, effort: "low" })).toStrictEqual({
    model: "opus",
    effort: "low",
  });
  expect(selectionFrom(null)).toStrictEqual({});
  const directory = await mkdtemp(join(tmpdir(), "projector-agent-defaults-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
  try {
    const { preferences, setAgentDefault } = await import("../server/modules/preferences/index.ts");
    expect((await preferences()).agentDefaults).toStrictEqual({});
    await setAgentDefault("codex", "model", "gpt-6-luna");
    await setAgentDefault("codex", "reasoning_effort", "high");
    await setAgentDefault("opencode", "model", "x/y");
    expect((await preferences()).agentDefaults).toStrictEqual({
      codex: { model: "gpt-6-luna", reasoning_effort: "high" },
      opencode: { model: "x/y" },
    });
    await expect(setAgentDefault("", "model", "x")).rejects.toThrow();
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("the codex npx fallback is pinned to a version", async () => {
  const { ACP_PROGRAMS } = await import("../server/modules/agent/acp-programs.ts");
  expect(ACP_PROGRAMS.codex.args.at(-1)).toMatch(/^@agentclientprotocol\/codex-acp@\d+\.\d+\.\d+$/);
});

test("ACP authenticates once when the agent refuses a session", async () => {
  const { openSession } = await import("../server/modules/agent/acp-backend.ts");
  const calls = [];
  let authenticated = false;
  const connection = {
    request: async (method) => {
      calls.push(method);
      if (method === "session/new") {
        if (!authenticated) throw new Error("Authentication required");
        return { sessionId: "after-auth" };
      }
      if (method === "authenticate") authenticated = true;
      return {};
    },
  };
  expect(
    await openSession(connection, { cwd: "/tmp" }, [{ id: "cursor_login" }], () => {}),
  ).toMatchObject({ sessionId: "after-auth", resumed: false });
  expect(calls).toStrictEqual(["session/new", "authenticate", "session/new"]);
});

test("chat history keeps the native session of a turn", async () => {
  const directory = await mkdtemp(join(tmpdir(), "projector-agent-session-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
  try {
    const turns = [
      {
        id: "1",
        role: "assistant",
        text: "ok",
        tools: [],
        session: { backend: "claude-code", id: "s1" },
      },
    ];
    await writeAgentHistory("p", turns);
    expect(await readAgentHistory("p")).toStrictEqual(turns);
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("agent session modes default to the terminal and persist only a GUI choice", async () => {
  const { preferences, setAgentMode } = await import("../server/modules/preferences/index.ts");
  const directory = await mkdtemp(join(tmpdir(), "projector-agent-modes-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
  try {
    expect((await preferences()).agentModes).toStrictEqual({});
    await setAgentMode("claude", "gui");
    expect((await preferences()).agentModes).toStrictEqual({ claude: "gui" });
    await setAgentMode("codex", "gui");
    expect((await preferences()).agentModes).toStrictEqual({ claude: "gui", codex: "gui" });
    await expect(setAgentMode("shell", "gui")).rejects.toThrow(/графическ/);
    await setAgentMode("claude", "tui");
    expect((await preferences()).agentModes).toStrictEqual({ codex: "gui" });
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
