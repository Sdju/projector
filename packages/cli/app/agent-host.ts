// Holds one coding-agent process (an ACP server) for a chat turn, independent of the Projector
// server: a server restart or hot reload must not stop an answer in progress.
//
// Usage: node agent-host.ts <run directory> <socket address>
//
// The run directory holds `spec.json` ({ command, args, shell, cwd }) and receives:
//   trace.log  every JSON-RPC line in order, `< ` from the agent, `> ` to it, `! ` for events of
//              the host itself ({"exit":...}, {"error":...}); a restarted server replays it;
// One server at a time connects to the socket: it gets the whole trace, then `! {"live":true}`,
// then new agent lines as they arrive; lines it writes go to the agent's stdin.
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";

interface AgentSpec {
  command: string;
  args?: string[];
  shell?: boolean;
  cwd?: string;
}

interface RpcMessage {
  method?: string;
  id?: unknown;
}

const [dir, address] = process.argv.slice(2);
if (!dir || !address) throw new Error("Usage: agent-host.ts <run directory> <socket address>");

/** Without a connected server the agent finishes its turn, then is stopped after this long. */
const IDLE_MS = Number(process.env.PROJECTOR_AGENT_IDLE_MS) || 30 * 60_000;
const STDERR_LIMIT = 4000;

const spec = JSON.parse(readFileSync(join(dir, "spec.json"), "utf8")) as AgentSpec;
if (!spec.command) throw new Error("spec.command отсутствует");
const trace = join(dir, "trace.log");
writeFileSync(trace, "", { mode: 0o600 });

let client: net.Socket | null = null;
let idleTimer: NodeJS.Timeout | undefined;
let finished = false;
let stderrTail = "";
const prompts = new Set<string>();
let turnFinished = false;

function rpcMessage(message: string): RpcMessage | undefined {
  try {
    const value = JSON.parse(message) as unknown;
    return value && typeof value === "object" ? (value as RpcMessage) : undefined;
  } catch {
    return undefined;
  }
}

// ACP servers stay alive after a turn. Once nobody is listening, a finished turn must release
// the native session lock; its trace remains available for the next server to replay.
function observe(message: string, outgoing: boolean): void {
  const rpc = rpcMessage(message);
  if (!rpc) return;
  if (outgoing && rpc.method === "session/prompt" && rpc.id !== undefined) {
    prompts.add(JSON.stringify(rpc.id));
    turnFinished = false;
  } else if (
    !outgoing &&
    !rpc.method &&
    rpc.id !== undefined &&
    prompts.delete(JSON.stringify(rpc.id))
  ) {
    turnFinished = true;
    if (!client || client.destroyed) child.kill("SIGTERM");
  }
}

function record(mark: "<" | ">" | "!", text: string): void {
  try {
    appendFileSync(trace, `${mark} ${text}\n`);
  } catch {
    // The run was removed under the host (cancelled elsewhere); the agent still finishes its turn.
  }
}

function send(mark: "<" | ">" | "!", text: string): void {
  if (client && !client.destroyed) client.write(`${mark} ${text}\n`);
}

function armIdle(): void {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => child.kill("SIGTERM"), IDLE_MS);
}

function lines(onLine: (line: string) => void): (chunk: string) => void {
  let rest = "";
  return (chunk: string) => {
    rest += chunk;
    let end: number;
    while ((end = rest.indexOf("\n")) !== -1) {
      const line = rest.slice(0, end).replace(/\r$/, "");
      rest = rest.slice(end + 1);
      if (line) onLine(line);
    }
  };
}

const child = spawn(spec.command, spec.args ?? [], {
  cwd: spec.cwd,
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
  shell: spec.shell === true,
});
child.stdin.on("error", () => {});
child.stdout.setEncoding("utf8");
child.stdout.on(
  "data",
  lines((line) => {
    record("<", line);
    send("<", line);
    observe(line, false);
  }),
);
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk: string) => {
  stderrTail = (stderrTail + chunk).slice(-STDERR_LIMIT);
});

function finish(event: Record<string, unknown>): void {
  if (finished) return;
  finished = true;
  clearTimeout(idleTimer);
  const text = JSON.stringify(event);
  record("!", text);
  send("!", text);
  const done = () => process.exit(0);
  server.close();
  if (client && !client.destroyed) client.end(done);
  else done();
  setTimeout(done, 1000).unref();
}

child.on("error", (error: NodeJS.ErrnoException) =>
  finish({ error: { code: error.code, message: error.message } }),
);
child.on("close", (code: number | null, signal: NodeJS.Signals | null) =>
  finish({ exit: { code, signal, stderr: stderrTail } }),
);

const server = net.createServer((socket) => {
  if (client && !client.destroyed) {
    client.write('! {"replaced":true}\n');
    client.destroy();
  }
  client = socket;
  clearTimeout(idleTimer);
  socket.setEncoding("utf8");
  socket.on("error", () => {});
  // Reading the trace and attaching the socket happen in one tick, so no line is missed or doubled.
  socket.write(readFileSync(trace, "utf8"));
  socket.write('! {"live":true}\n');
  socket.on(
    "data",
    lines((line) => {
      record(">", line);
      observe(line, true);
      if (child.stdin.writable) child.stdin.write(`${line}\n`);
    }),
  );
  socket.on("close", () => {
    if (client !== socket) return;
    client = null;
    if (!finished) {
      if (turnFinished) child.kill("SIGTERM");
      else armIdle();
    }
  });
});
server.listen(address);
server.on("error", (error: Error) => finish({ error: { message: error.message } }));
armIdle();

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
  process.on(signal, () => {
    child.kill("SIGTERM");
    setTimeout(() => finish({ exit: { code: null, signal, stderr: stderrTail } }), 500).unref();
  });
}
