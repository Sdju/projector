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
    const result = await os.tools.runBash("pwd; printf failure >&2; exit 7", { cwd });
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
    await expect(setAgentMode("codex", "gui")).rejects.toThrow(/графическ/);
    await setAgentMode("claude", "tui");
    expect((await preferences()).agentModes).toStrictEqual({});
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
