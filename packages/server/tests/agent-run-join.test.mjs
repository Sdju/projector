import "../../../tests/helpers/builtins.mjs";
import { expect, test } from "vite-plus/test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("a page opening a chat being answered here joins the run instead of attaching to the host", async () => {
  const directory = await mkdtemp(join(tmpdir(), "projector-join-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
  try {
    const { createRun } = await import("../modules/agent/agent-runs.ts");
    const { driveRun } = await import("../modules/agent/run-hub.ts");
    const { handleAgentRun } = await import("../modules/agent/run-request.ts");

    const runId = await createRun({ backend: "codex", message: "hi", history: [] });
    const chunks = [];
    const res = {
      writableEnded: false,
      ended: false,
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers ?? {};
      },
      write(chunk) {
        chunks.push(String(chunk));
        return true;
      },
      end() {
        this.writableEnded = true;
        this.ended = true;
      },
      on() {},
    };

    // The server drives the run: the join must replay its events and never start a host process.
    const driver = driveRun(runId, { emit() {}, close() {} });
    driver.publish("run", { id: runId });
    driver.publish("text", { text: "one" });

    const joined = handleAgentRun({ res, body: { attach: runId } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    driver.publish("text", { text: "two" });
    driver.publish("done", { text: "onetwo" });
    driver.finish();
    await joined;

    const body = chunks.join("");
    expect(body).toContain("event: run");
    expect(body).toContain('"text":"one"');
    expect(body).toContain('"text":"two"');
    expect(body).toContain("event: done");
    expect(res.ended).toBe(true);
    // The page learns the run from the response, before the first event is replayed.
    expect(res.headers["X-Agent-Run"]).toBe(runId);
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("a closed page cannot create a run or clear a pending chat continuation", async ({
  onTestFinished,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "projector-run-stream-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
  const { attachSse, updateEventPages } = await import("../modules/events/index.ts");
  const { registerAgentBackend, unregisterAgentBackend } =
    await import("../modules/agent/registry.ts");
  const { handleAgentRun } = await import("../modules/agent/run-request.ts");
  const { listRecentRuns, recordRecentRun } = await import("../modules/agent/recent-runs.ts");
  const backend = "test-run-stream";
  const chat = "test-run-stream:project:chat";
  const req = Object.assign(new EventEmitter(), { url: "/api/events?client=shared" });
  const chunks = [];
  let calls = 0;
  registerAgentBackend({
    id: backend,
    label: backend,
    capabilities: { hosted: true },
    async run({ emit }) {
      calls++;
      emit("text", { text: "hello" });
      emit("done", { text: "hello" });
    },
  });
  onTestFinished(async () => {
    req.emit("close");
    unregisterAgentBackend(backend);
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(directory, { recursive: true, force: true });
  });
  const now = Date.now();
  const resume = { auto: true, at: now + 60000 };
  await recordRecentRun({
    id: "previous",
    backend,
    chat,
    projectId: "project",
    topic: " previous",
    status: "error",
    startedAt: now,
    endedAt: now,
    resume,
  });
  function response() {
    return {
      writableEnded: false,
      writeHead(status) {
        this.statusCode = status;
        return this;
      },
      setHeader() {},
      on() {},
      write(chunk) {
        chunks.push(chunk);
      },
      end() {
        this.writableEnded = true;
      },
    };
  }
  const body = { backend, chat, message: "hello", client: "page", stream: "result" };
  const rejected = response();
  await handleAgentRun({ res: rejected, body });
  expect(rejected.statusCode).toBe(409);
  expect(await readdir(join(directory, "projector/agent/runs")).catch(() => [])).toEqual([]);
  expect((await listRecentRuns()).find((item) => item.chat === chat)?.resume).toEqual(resume);
  expect(calls).toBe(0);

  attachSse(req, response());
  expect(updateEventPages("shared", ["page"], [])).toBe(true);
  const accepted = response();
  await handleAgentRun({ res: accepted, body });
  expect(accepted.statusCode).toBe(202);
  expect(chunks.join("")).toContain('"stream":"result","event":"done","data":{"text":"hello"}');
  expect(calls).toBe(1);

  const direct = response();
  await handleAgentRun({ res: direct, body: { backend, message: "direct" } });
  expect(direct.statusCode).toBe(200);
  expect(chunks.join("")).toContain('event: done\ndata: {"text":"hello"}');
  expect(calls).toBe(2);
});
