// Holds one coding-agent process (an ACP server) for a chat turn, independent of the Projector
// server: a server restart or hot reload must not stop an answer in progress.
//
// Usage: node agent-host.mjs <run directory> <socket address>
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

const [dir, address] = process.argv.slice(2);
if (!dir || !address) throw new Error("Usage: agent-host.mjs <run directory> <socket address>");

/** Without a connected server the agent finishes its turn, then is stopped after this long. */
const IDLE_MS = Number(process.env.PROJECTOR_AGENT_IDLE_MS) || 30 * 60_000;
const STDERR_LIMIT = 4000;

const spec = JSON.parse(readFileSync(join(dir, "spec.json"), "utf8"));
const trace = join(dir, "trace.log");
writeFileSync(trace, "", { mode: 0o600 });

let client = null;
let idleTimer;
let finished = false;
let stderrTail = "";

const record = (mark, text) => {
  try {
    appendFileSync(trace, `${mark} ${text}\n`);
  } catch {
    // The run was removed under the host (cancelled elsewhere); the agent still finishes its turn.
  }
};
const send = (mark, text) => {
  if (client && !client.destroyed) client.write(`${mark} ${text}\n`);
};

function armIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => child.kill("SIGTERM"), IDLE_MS);
}

const lines = (onLine) => {
  let rest = "";
  return (chunk) => {
    rest += chunk;
    let end;
    while ((end = rest.indexOf("\n")) !== -1) {
      const line = rest.slice(0, end).replace(/\r$/, "");
      rest = rest.slice(end + 1);
      if (line) onLine(line);
    }
  };
};

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
  }),
);
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderrTail = (stderrTail + chunk).slice(-STDERR_LIMIT);
});

function finish(event) {
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

child.on("error", (error) => finish({ error: { code: error.code, message: error.message } }));
child.on("close", (code, signal) => finish({ exit: { code, signal, stderr: stderrTail } }));

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
      if (child.stdin.writable) child.stdin.write(`${line}\n`);
    }),
  );
  socket.on("close", () => {
    if (client !== socket) return;
    client = null;
    if (!finished) armIdle();
  });
});
server.listen(address);
server.on("error", (error) => finish({ error: { code: error.code, message: error.message } }));
armIdle();

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => {
    child.kill("SIGTERM");
    setTimeout(() => finish({ exit: { code: null, signal, stderr: stderrTail } }), 500).unref();
  });
}
