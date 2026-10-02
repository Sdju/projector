import assert from "node:assert/strict";
import { test } from "node:test";
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
  assert.notEqual(requests[0].id, requests[1].id);
  assert.equal(completeCommandRequest(requests[1].id, { output: "second" }), true);
  assert.equal(await second, "second");
  assert.equal(completeCommandRequest(requests[1].id, { output: "again" }), false);
  assert.equal(completeCommandRequest(requests[0].id, { error: "failure" }), true);
  await assert.rejects(first, /failure/);
  await assert.rejects(bridge({ operation: "list" }), /не ответил/);
  const cancelled = bridge({ operation: "list" });
  abort.abort();
  await assert.rejects(cancelled, /остановлен/);
  assert.equal(completeCommandRequest(requests.at(-1).id, {}), false);
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
  assert.deepEqual(
    (await call("list_commands", {})).commands.map((c) => c.id),
    ["ide.fileTree.file.rename"],
  );
  await assert.rejects(
    async () => call("execute_command", { command: "ide.fileTree.file.rename", scope: "tree" }),
    /Сначала/,
  );
  const description = await call("describe_command", {
    command: "ide.fileTree.file.rename",
    scope: "tree",
  });
  assert.ok(description.arguments.name);
  assert.equal(description.enabled, false);
  await assert.rejects(
    call("execute_command", { command: description.id, scope: "tree", args: { path: "bad" } }),
    /недоступна/,
  );
  assert.deepEqual(
    await call("execute_command", {
      command: description.id,
      scope: "tree",
      args: { path: "old.md", name: "new.md" },
    }),
    { destination: "new.md" },
  );
  assert.equal(output, "new.md");
  await assert.rejects(
    commands({ operation: "execute", scope: "other", command: "secret" }),
    /недоступна/,
  );
  scope.dispose();
  await assert.rejects(
    commands({ operation: "execute", scope: "tree", command: description.id }),
    /недоступна/,
  );
});

test("Bash uses cwd, returns failure status, bounds output and aborts subprocesses", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "projector-agent-shell-"));
  try {
    const result = await os.tools.runBash("pwd; printf failure >&2; exit 7", { cwd });
    assert.equal(result.stdout.trim(), cwd);
    assert.equal(result.stderr, "failure");
    assert.equal(result.exitCode, 7);
    const bounded = await os.tools.runBash("yes agent", { cwd });
    assert.equal(bounded.terminated, true);
    assert.ok(Buffer.byteLength(bounded.stdout) <= 256 * 1024);
    const abort = new AbortController();
    const running = os.tools.runBash("sleep 100 & wait", { cwd, signal: abort.signal });
    setTimeout(() => abort.abort(), 30);
    await assert.rejects(running, /остановлен/);
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
    assert.deepEqual(await readAgentHistory("a/../../b"), turns);
    assert.deepEqual(await readAgentHistory("other"), []);
    await assert.rejects(writeAgentHistory("a", [{ role: "system" }]));
    await writeAgentHistory("a/../../b", []);
    assert.deepEqual(await readAgentHistory("a/../../b"), []);
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
    assert.equal(executed, true);
    assert.equal(requests.length, 5);
    assert.deepEqual(
      events.filter((e) => e.event === "tool").map((e) => e.data.name),
      steps.map((s) => s[0]),
    );
    assert.equal(
      events.find((e) => e.event === "error"),
      undefined,
    );
    assert.equal(events.find((e) => e.event === "done").data.text, "agent-http-ok");
    assert.equal(
      events.find((e) => e.event === "tool-result" && e.data.name === "bash").data.output.stdout,
      "agent-shell-ok",
    );
    assert.ok(
      requests
        .at(-1)
        .messages.some((m) => m.role === "tool" && m.content.includes("agent-shell-ok")),
    );
    const rejected = await originalFetch(base + "/api/agent", {
      method: "POST",
      headers: { Origin: "https://foreign.example", "Content-Type": "application/json" },
      body: '{"message":"test"}',
    });
    assert.equal(rejected.status, 403);
    assert.equal(
      (
        await originalFetch(base + "/api/agent/tool-result", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: '{"id":"expired"}',
        })
      ).status,
      410,
    );
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
