import "./helpers/builtins.mjs";
import { expect, test } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("a page opening a chat being answered here joins the run instead of attaching to the host", async () => {
  const directory = await mkdtemp(join(tmpdir(), "projector-join-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
  try {
    const { createRun } = await import("../packages/server/modules/agent/agent-runs.ts");
    const { driveRun } = await import("../packages/server/modules/agent/run-hub.ts");
    const { handleAgentRun } = await import("../packages/server/modules/agent/run-request.ts");

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
