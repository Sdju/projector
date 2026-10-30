import { expect, test } from "vite-plus/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import {
  createRun,
  listLiveRuns,
  readRun,
  removeRun,
  runDirectory,
  stopRun,
} from "../server/modules/agent/agent-runs.ts";
import { startHosted, attachHosted } from "../server/modules/agent/hosted-process.ts";
import { createAcpConnection } from "../server/modules/agents/acp/acp-client.ts";
import { os } from "../core/modules/os/index.ts";

async function until(check) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition not met in time");
}

async function withHost(work) {
  const directory = await mkdtemp(join(tmpdir(), "projector-recovery-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
  let id;
  try {
    const script = join(directory, "agent.cjs");
    const finish = join(directory, "finish");
    await writeFile(
      script,
      `
      const fs = require("node:fs");
      const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
      let prompt;
      require("node:readline").createInterface({ input: process.stdin }).on("line", line => {
        const rpc = JSON.parse(line);
        if (rpc.method === "session/prompt") {
          prompt = rpc.id;
          send({method: "session/update", params: {working: true}});
        } else send({id: rpc.id, result: rpc.method === "session/new" ? {sessionId: "s1"} : {protocolVersion: 1}});
      });
      setInterval(() => {
        if (prompt && fs.existsSync(${JSON.stringify(finish)})) {
          send({id: prompt, result: {stopReason: "end_turn"}});
          prompt = undefined;
        }
      }, 25);
    `,
    );
    id = await createRun({ backend: "kimi", message: "probe", history: [], chat: "probe" });
    const first = await startHosted(id, {
      command: process.execPath,
      args: [script],
      cwd: directory,
      env: process.env,
    });
    const { pid, identity } = JSON.parse(
      await readFile(join(runDirectory(id), "process.json"), "utf8"),
    );
    await work({ id, first, pid, identity, finish });
  } finally {
    if (id) await stopRun(id);
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
  }
}

const handlers = { onNotification() {}, onRequest: () => ({}) };
async function handshake(connection) {
  await connection.request("initialize", {});
  await connection.request("session/new", {});
}

test("a replaced reader cannot erase the live run owned by the new reader", async () => {
  await withHost(async ({ id, first, pid, identity, finish }) => {
    let working = false;
    const old = createAcpConnection(first, {
      ...handlers,
      onNotification: () => {
        working = true;
      },
    });
    await handshake(old);
    const interrupted = old.request("session/prompt", {}, 0).catch((error) => error);
    await until(() => working);
    const next = createAcpConnection(await attachHosted(id), handlers);
    expect(await interrupted).toBeInstanceOf(Error);
    await old.close();
    // The old API handler attempts the same cleanup after delivering its error.
    expect(await removeRun(id)).toBe(false);
    expect(await readRun(id)).not.toBeNull();
    expect(await listLiveRuns()).toEqual([expect.objectContaining({ id, backend: "kimi" })]);
    expect(await os.processes.identity(pid)).toBe(identity);
    await handshake(next);
    const result = next.request("session/prompt", {}, 0);
    await writeFile(finish, "");
    expect(await result).toEqual({ stopReason: "end_turn" });
    await next.close();
    await until(async () => (await os.processes.identity(pid)) === null);
    expect(await removeRun(id)).toBe(true);
    expect(await readRun(id)).toBeNull();
  });
}, 30000);

test(
  "an ACP turn completed without a reader releases its process and remains replayable",
  // Windows named-pipe/process teardown is not deterministic enough for this replay assertion.
  { skip: process.platform === "win32", timeout: 30000 },
  async () => {
    await withHost(async ({ id, first, pid, finish }) => {
      let working = false;
      const original = createAcpConnection(first, {
        ...handlers,
        onNotification: () => {
          working = true;
        },
      });
      await handshake(original);
      const interrupted = original.request("session/prompt", {}, 0).catch(() => {});
      await until(() => working);
      first.detach();
      await interrupted;
      await writeFile(finish, "");
      await until(async () => (await os.processes.identity(pid)) === null);
      expect(await readRun(id)).not.toBeNull();
      expect(await listLiveRuns()).toEqual([]);
      const replay = createAcpConnection(await attachHosted(id), handlers);
      await handshake(replay);
      expect(await replay.request("session/prompt", {}, 0)).toEqual({ stopReason: "end_turn" });
      await replay.close();
    });
  },
);

test("ACP errors retain the agent's explanation of an internal error", async () => {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill() {},
  });
  const connection = createAcpConnection(child, handlers);
  const response = connection.request("session/load", {});
  child.stdout.write(
    JSON.stringify({
      id: 1,
      error: {
        code: -32603,
        message: "Internal error",
        data: { details: "This session is in use by another instance." },
      },
    }) + "\n",
  );
  await expect(response).rejects.toMatchObject({
    code: -32603,
    message: "Internal error: This session is in use by another instance.",
  });
  await connection.close();
});
