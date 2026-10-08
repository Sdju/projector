import { EventEmitter } from "node:events";
import { closeSync, openSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { os, type AgentProcess, type AgentProcessSpec } from "../../../core/modules/os/index.ts";
import { rememberHost, runDirectory } from "./agent-runs.ts";

const HOST_SCRIPT = fileURLToPath(new URL("../../../cli/app/agent-host.mjs", import.meta.url));
/** How long a freshly started host gets to open its socket. */
const START_TIMEOUT_MS = 8000;
const STOP_TIMEOUT_MS = 5000;

interface Entry {
  mark: "<" | ">" | "!";
  text: string;
  message?: Record<string, unknown>;
}

const isRequest = (message?: Record<string, unknown>) =>
  !!message && message.method !== undefined && message.id !== undefined;
const idKey = (message: Record<string, unknown>) => JSON.stringify(message.id);

function parse(line: string): Entry | undefined {
  const mark = line[0];
  if (mark !== "<" && mark !== ">" && mark !== "!") return undefined;
  const text = line.slice(2);
  try {
    return { mark, text, message: JSON.parse(text) };
  } catch {
    return { mark, text };
  }
}

/**
 * Start a hosted agent: `agent-host.mjs` keeps the process and the log of its JSON-RPC traffic
 * outside this server, which only holds a socket to it. The returned process behaves like a
 * spawned one for `createAcpConnection`.
 */
export async function startHosted(runId: string, spec: AgentProcessSpec): Promise<AgentProcess> {
  const dir = runDirectory(runId);
  await writeFile(
    join(dir, "spec.json"),
    JSON.stringify({ command: spec.command, args: spec.args, cwd: spec.cwd }),
    { mode: 0o600 },
  );
  const address = os.tools.agentHostAddress(dir);
  const log = openSync(join(dir, "host.log"), "a");
  let pid: number | undefined;
  try {
    pid = os.tools.spawnAgentHost({
      script: HOST_SCRIPT,
      dir,
      address,
      env: spec.env ?? {},
      log,
    });
  } finally {
    closeSync(log);
  }
  if (!pid) throw new Error("Не удалось запустить процесс агента");
  await rememberHost(runId, pid);
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (true) {
    try {
      return await openHosted(dir, address);
    } catch (error) {
      if (Date.now() > deadline || os.processes.identity(pid) === null) {
        const tail = (await readFile(join(dir, "host.log"), "utf8").catch(() => "")).trim();
        throw new Error(tail ? `Не удалось запустить агента: ${tail.slice(-500)}` : String(error));
      }
      await sleep(40);
    }
  }
}

/** Rejoin a run of an earlier server: its whole traffic is replayed to the new connection. */
export function attachHosted(runId: string): Promise<AgentProcess> {
  const dir = runDirectory(runId);
  return openHosted(dir, os.tools.agentHostAddress(dir), true);
}

function connect(address: string): Promise<net.Socket | undefined> {
  return new Promise((resolve) => {
    const socket = net.connect(address);
    socket.once("connect", () => resolve(socket));
    socket.once("error", () => resolve(undefined));
  });
}

/**
 * The server side of a hosted agent. The host sends its trace (every line so far, in order), then
 * a `live` marker, then new lines. A fresh run has an empty trace; a rejoined one is replayed:
 * agent lines are handed to the new connection in order, but each request the earlier server had
 * written waits for the new connection to write it again and is *not* sent to the agent a second
 * time, and permission questions that were already answered are neither shown nor repeated.
 */
async function openHosted(
  dir: string,
  address: string,
  tolerateMissingHost = false,
): Promise<AgentProcess> {
  const socket = await connect(address);
  if (!socket && !tolerateMissingHost) throw new Error("Хост агента не отвечает");
  // A finished run has no host any more, but its trace on disk replays the same way.
  const offline = socket
    ? undefined
    : await readFile(join(dir, "trace.log"), "utf8").catch(() => null);
  if (offline === null) throw new Error("Ход не найден");

  const child = new EventEmitter() as unknown as AgentProcess & EventEmitter;
  const stdout = new PassThrough({ encoding: "utf8" });
  const stderr = new PassThrough({ encoding: "utf8" });
  const queue: Entry[] = [];
  let answered = new Set<string>();
  const pendingWrites: string[] = [];
  let live = false;
  let markLive = () => {};
  const ready = new Promise<void>((resolve) => {
    markLive = resolve;
  });
  let closed = false;
  let replaced = false;
  let inbound = "";
  let outbound = "";

  /** Events wait for the listeners: a rejoined run may already end while it is being replayed. */
  const emitLater = (event: string, ...args: unknown[]) =>
    setImmediate(() => child.emit(event, ...args));
  const fail = (message: string) => {
    emitLater("error", new Error(message));
    finish();
  };
  function finish(stderrTail = "") {
    if (closed) return;
    closed = true;
    if (stderrTail) stderr.write(stderrTail);
    socket?.destroy();
    // After the stderr tail has reached its listener, so the failure message can quote it.
    emitLater("close", null, null);
  }

  /** Delivers what can be delivered; stops at a request the new connection has not written yet. */
  function pump() {
    while (queue.length && !closed) {
      const entry = queue[0];
      if (entry.mark === "!") {
        queue.shift();
        const event = (entry.message ?? {}) as {
          exit?: { stderr?: string };
          error?: { code?: string; message?: string };
          replaced?: boolean;
        };
        if (event.replaced) replaced = true;
        if (event.error)
          emitLater("error", Object.assign(new Error(event.error.message), event.error));
        if (event.exit || event.error || event.replaced) finish(event.exit?.stderr);
        continue;
      }
      if (entry.mark === "<") {
        queue.shift();
        if (isRequest(entry.message) && answered.has(idKey(entry.message!))) continue;
        stdout.write(`${entry.text}\n`);
        continue;
      }
      queue.shift();
      if (!isRequest(entry.message)) continue; // an answer given to a request that is skipped above
      const line = pendingWrites.shift();
      if (line === undefined) {
        queue.unshift(entry);
        return;
      }
      const written = parse(`> ${line}`)?.message;
      if (written?.method !== entry.message!.method || written?.id !== entry.message!.id)
        return fail("Ход нельзя восстановить: запросы не совпали с прежними");
    }
    if (live) {
      for (const line of pendingWrites.splice(0)) socket?.write(`${line}\n`);
    }
  }

  function accept(line: string) {
    const entry = parse(line);
    if (!entry) return;
    if (entry.mark === "!" && (entry.message as { live?: boolean } | undefined)?.live === true) {
      answered = new Set(
        queue
          .filter((item) => item.mark === ">" && item.message && !item.message.method)
          .map((item) => idKey(item.message!)),
      );
      live = true;
      markLive();
    } else queue.push(entry);
    pump();
  }
  const feed = (chunk: string) => {
    inbound += chunk;
    let end;
    while ((end = inbound.indexOf("\n")) !== -1) {
      const line = inbound.slice(0, end);
      inbound = inbound.slice(end + 1);
      if (line) accept(line);
    }
  };

  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      outbound += String(chunk);
      let end;
      while ((end = outbound.indexOf("\n")) !== -1) {
        const line = outbound.slice(0, end);
        outbound = outbound.slice(end + 1);
        if (line) pendingWrites.push(line);
      }
      pump();
      callback();
    },
  });

  Object.assign(child, {
    stdin,
    stdout,
    stderr,
    pid: undefined,
    exitCode: null,
    signalCode: null,
    kill: () => void child.terminate(),
    /** Stops the agent unless a newer server took the run over, in which case only this link closes. */
    async terminate() {
      if (closed) return;
      const done = new Promise<void>((resolve) => child.once("close", () => resolve()));
      if (replaced) return finish();
      const pid = await hostedPid(dir);
      if (pid) os.tools.killAgentTree(pid);
      else return finish();
      await Promise.race([done, sleep(STOP_TIMEOUT_MS)]);
      finish();
    },
    /** Lets go of the run without stopping it: the next server rejoins it. */
    detach: () => finish(),
  });

  if (socket) {
    socket.setEncoding("utf8");
    socket.on("data", feed);
    socket.on("error", () => {});
    socket.on("close", () => {
      if (!closed) {
        queue.push({ mark: "!", text: "", message: { exit: { stderr: "" } } });
        pump();
      }
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      ready,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, START_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);
    if (!live) {
      socket.destroy();
      throw new Error("Хост агента не ответил");
    }
  } else {
    // The host is gone: replay the trace as it ended, with a synthetic end if the run was cut short.
    setImmediate(() => {
      feed(offline!);
      feed('! {"live":true}\n');
      if (!closed) {
        queue.push({ mark: "!", text: "", message: { exit: { stderr: "" } } });
        pump();
      }
    });
  }
  return child;
}

async function hostedPid(dir: string): Promise<number | undefined> {
  try {
    const { pid, identity } = JSON.parse(await readFile(join(dir, "process.json"), "utf8"));
    return os.processes.identity(pid) === identity ? pid : undefined;
  } catch {
    return undefined;
  }
}
