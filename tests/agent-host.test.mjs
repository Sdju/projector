import { expect, test } from "vite-plus/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A scripted ACP agent: after the prompt it streams a chunk, asks for a permission, waits for the
// answer, streams another chunk and finishes. Every line it receives is recorded for the test.
const FAKE_AGENT = `
const fs = require("node:fs");
const [log] = process.argv.slice(2);
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
let prompt;
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf("\\n")) !== -1) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (!line) continue;
    fs.appendFileSync(log, line + "\\n");
    const message = JSON.parse(line);
    if (message.method === "initialize") send({ jsonrpc: "2.0", id: message.id, result: { authMethods: [] } });
    else if (message.method === "session/new") send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "s1" } });
    else if (message.method === "session/prompt") {
      prompt = message.id;
      send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "one" } } } });
      send({ jsonrpc: "2.0", id: 100, method: "session/request_permission", params: { toolCall: { title: "ls" }, options: [{ optionId: "allow", kind: "allow_once" }] } });
    } else if (message.id === 100 && !message.method) {
      setTimeout(() => {
        send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "two" } } } });
        send({ jsonrpc: "2.0", id: prompt, result: { stopReason: "end_turn" } });
      }, 300);
    }
  }
});
setInterval(() => {}, 1000);
`;

async function until(check, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition not met in time");
}

test("an agent run survives its server and is rejoined with the whole answer replayed", async () => {
  if (process.platform === "win32") return;
  const directory = await mkdtemp(join(tmpdir(), "projector-host-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
  try {
    const { createRun } = await import("../server/modules/agent/agent-runs.ts");
    const { startHosted, attachHosted } = await import("../server/modules/agent/hosted-process.ts");
    const { createAcpConnection, NO_TIMEOUT } =
      await import("../server/modules/agent/acp-client.ts");
    const { os } = await import("../core/modules/os/index.ts");

    const script = join(directory, "fake-agent.cjs");
    const received = join(directory, "received.log");
    await writeFile(script, FAKE_AGENT);
    const runId = await createRun({ backend: "codex", message: "hi", history: [] });
    const spec = {
      command: process.execPath,
      args: [script, received],
      cwd: directory,
      env: process.env,
    };

    // The first server: starts the run, gets as far as the unanswered permission, then "dies".
    const first = await startHosted(runId, spec);
    const firstUpdates = [];
    const asked = [];
    const connection = createAcpConnection(first, {
      onNotification: (_, params) => firstUpdates.push(params.update.content.text),
      onRequest: (method) => {
        asked.push(method);
        return new Promise(() => {});
      },
    });
    await connection.request("initialize", { protocolVersion: 1 });
    await connection.request("session/new", { cwd: directory, mcpServers: [] });
    void connection
      .request(
        "session/prompt",
        { sessionId: "s1", prompt: [{ type: "text", text: "hi" }] },
        NO_TIMEOUT,
      )
      .catch(() => {});
    await until(() => asked.length === 1);
    expect(firstUpdates).toStrictEqual(["one"]);
    first.detach();

    // The agent is still there after its server is gone.
    const { pid, identity } = JSON.parse(
      await readFile(join(directory, "projector/agent/runs", runId, "process.json"), "utf8"),
    );
    expect(os.processes.identity(pid)).toBe(identity);

    // The next server repeats the request; the host replays what happened and the agent goes on.
    const rejoined = await attachHosted(runId);
    const updates = [];
    const questions = [];
    const second = createAcpConnection(rejoined, {
      onNotification: (_, params) => updates.push(params.update.content.text),
      onRequest: (method, params) => {
        questions.push(params.toolCall.title);
        return { outcome: { outcome: "selected", optionId: "allow" } };
      },
    });
    await second.request("initialize", { protocolVersion: 1 });
    await second.request("session/new", { cwd: directory, mcpServers: [] });
    const result = await second.request(
      "session/prompt",
      { sessionId: "s1", prompt: [{ type: "text", text: "hi" }] },
      NO_TIMEOUT,
    );
    expect(result).toStrictEqual({ stopReason: "end_turn" });
    expect(updates).toStrictEqual(["one", "two"]);
    expect(questions).toStrictEqual(["ls"]);
    // The agent saw each request once and the answer once: nothing was sent twice.
    const methods = (await readFile(received, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .map((message) => message.method ?? `answer:${message.id}`);
    expect(methods).toStrictEqual(["initialize", "session/new", "session/prompt", "answer:100"]);
    await second.close();
    await until(() => os.processes.identity(pid) === null);

    // After the host is gone the trace on disk still replays, and answered questions stay answered.
    const finished = await attachHosted(runId);
    const replayed = [];
    const asking = [];
    const third = createAcpConnection(finished, {
      onNotification: (_, params) => replayed.push(params.update.content.text),
      onRequest: (method) => asking.push(method),
    });
    await third.request("initialize", { protocolVersion: 1 });
    await third.request("session/new", { cwd: directory, mcpServers: [] });
    expect(
      await third.request(
        "session/prompt",
        { sessionId: "s1", prompt: [{ type: "text", text: "hi" }] },
        NO_TIMEOUT,
      ),
    ).toStrictEqual({ stopReason: "end_turn" });
    expect(replayed).toStrictEqual(["one", "two"]);
    expect(asking).toStrictEqual([]);
    await third.close();
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

test("stopping a hosted run kills the agent and everything it started", async () => {
  if (process.platform === "win32") return;
  const directory = await mkdtemp(join(tmpdir(), "projector-host-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
  try {
    const { createRun } = await import("../server/modules/agent/agent-runs.ts");
    const { startHosted } = await import("../server/modules/agent/hosted-process.ts");
    const { createAcpConnection } = await import("../server/modules/agent/acp-client.ts");
    const { os } = await import("../core/modules/os/index.ts");
    const runId = await createRun({ backend: "codex", message: "hi", history: [] });
    const child = await startHosted(runId, {
      command: process.execPath,
      args: [
        "-e",
        'const { spawn } = require("node:child_process"); const grandchild = spawn("sleep", ["300"]); process.stdout.write(JSON.stringify({ pid: grandchild.pid }) + "\\n"); setInterval(() => {}, 1000);',
      ],
      cwd: directory,
      env: process.env,
    });
    const pid = await new Promise((resolve) => {
      child.stdout.on("data", (chunk) => {
        const match = /"pid":(\d+)/.exec(String(chunk));
        if (match) resolve(Number(match[1]));
      });
    });
    const connection = createAcpConnection(child, { onNotification() {}, onRequest: () => ({}) });
    await connection.close();
    await until(() => os.processes.identity(pid) === null);
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

test("a run started by an earlier server is stopped from its identity, never by a reused pid", async () => {
  if (process.platform === "win32") return;
  const directory = await mkdtemp(join(tmpdir(), "projector-host-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
  try {
    const { createRun, stopRun, cancelRun, readRun } =
      await import("../server/modules/agent/agent-runs.ts");
    const { startHosted } = await import("../server/modules/agent/hosted-process.ts");
    const { os } = await import("../core/modules/os/index.ts");
    const runId = await createRun({ backend: "codex", message: "hi", history: [] });
    const child = await startHosted(runId, {
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: directory,
      env: process.env,
    });
    const processFile = join(directory, "projector/agent/runs", runId, "process.json");
    const { pid, identity } = JSON.parse(await readFile(processFile, "utf8"));
    child.detach();
    // A recorded identity that no longer matches the pid is left alone.
    await writeFile(processFile, JSON.stringify({ pid, identity: "someone else" }));
    await stopRun(runId);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(os.processes.identity(pid)).toBe(identity);
    // The matching identity stops the host and the cancel removes the run.
    await writeFile(processFile, JSON.stringify({ pid, identity }));
    await cancelRun(runId);
    await until(() => os.processes.identity(pid) === null);
    expect(await readRun(runId)).toBe(null);
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

test("finished runs nobody rejoined are collected after their retention", async () => {
  const directory = await mkdtemp(join(tmpdir(), "projector-host-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
  try {
    const { createRun, pruneRuns, readRun } = await import("../server/modules/agent/agent-runs.ts");
    const { utimes } = await import("node:fs/promises");
    const record = { backend: "codex", message: "hi", history: [] };
    const fresh = await createRun(record);
    const stale = await createRun(record);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(join(directory, "projector/agent/runs", stale, "run.json"), old, old);
    await pruneRuns();
    expect(await readRun(fresh)).not.toBe(null);
    expect(await readRun(stale)).toBe(null);
    // Far in the future everything is past its retention.
    await pruneRuns(Date.now() + 3 * 60 * 60 * 1000);
    expect(await readRun(fresh)).toBe(null);
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
