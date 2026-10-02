import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { WebSocket } from "ws";

const root = await mkdtemp(join(tmpdir(), "projector-terminal-"));
process.env.XDG_DATA_HOME = root;
process.env.SHELL = "/bin/bash";
await mkdir(join(root, "projector"));
const project = {
  id: "terminal-probe",
  name: "Terminal probe",
  path: root,
  url: "",
  icon: "",
  mode: "server",
  defaultCommandId: "dev",
  commands: [
    {
      id: "dev",
      name: "dev",
      cmd: `test -t 0 && test -t 1 && printf 'RUN_%s\\nhttp://127.0.0.1:43210/\\n' PTY; read value; printf 'INPUT_%s\\n' "$value"; exit 7`,
    },
    { id: "wait", name: "wait", cmd: "sleep 60" },
  ],
  createdAt: "",
};
await writeFile(join(root, "projector/projects.json"), JSON.stringify({ projects: [project] }));
const { handleApi } = await import("../server/api.ts");
const { attachTerminalServer, listTerminalSessions, closeTerminalSession } =
  await import("../server/terminal.ts");
const server = createServer((req, res) => {
  void handleApi(req, res).then((handled) => {
    if (!handled) res.writeHead(404).end();
  });
});
attachTerminalServer(server);
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
const sockets = new Set();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, description) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await pause(20);
  }
  assert.fail(`Timed out: ${description}`);
}
async function request(suffix = "", method = "GET", body, headers = {}) {
  return fetch(`${base}/api/projects/${project.id}/terminals${suffix}`, {
    method,
    headers: { Origin: base, "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function connect(id, autoAck = true) {
  const client = new WebSocket(
    `${base.replace("http:", "ws:")}/api/terminal/socket?session=${id}`,
    { origin: base },
  );
  sockets.add(client);
  const messages = [];
  client.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    messages.push(message);
    if (autoAck && message.type === "output")
      client.send(JSON.stringify({ type: "ack", length: message.data.length }));
  });
  await once(client, "open");
  await until(() => messages.some((message) => message.type === "snapshot"), "initial snapshot");
  return {
    client,
    messages,
    autoAck: () => {
      autoAck = true;
    },
    send: (message) => client.send(JSON.stringify(message)),
    output: () =>
      messages
        .filter((message) => message.type === "output" || message.type === "snapshot")
        .map((message) => message.data)
        .join(""),
  };
}

await test("real PTY: input, Unicode, resize, interrupt, reconnect, alternate screen, isolation, exit and cleanup", async (t) => {
  t.after(async () => {
    for (const client of sockets) client.terminate();
    for (const session of listTerminalSessions(project.id))
      closeTerminalSession(project.id, session.id);
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const create = await request("", "POST", { program: "shell", cols: 90, rows: 30 });
  assert.equal(create.status, 201, await create.clone().text());
  const { session } = await create.json();
  const first = await connect(session.id);
  first.send({
    type: "input",
    data: "test -t 0 && test -t 1 && printf 'PTY_%s\\n' OK; pwd; printf 'Привет_日本語\\n'\r",
  });
  await until(
    () =>
      first.output().includes("PTY_OK") &&
      first.output().includes("Привет_日本語") &&
      first.output().includes(root),
    "interactive input and cwd",
  );
  first.send({ type: "resize", cols: 112, rows: 35 });
  await until(
    () =>
      first.messages.some((message) => message.type === "status" && message.session.cols === 112),
    "resize acknowledgement",
  );
  first.send({ type: "input", data: "stty size; printf 'NO_NEWLINE_%s' OK\r" });
  await until(
    () => first.output().includes("35 112") && first.output().includes("NO_NEWLINE_OK"),
    "PTY size and partial output",
  );
  first.send({ type: "input", data: "sleep 30\r" });
  await pause(150);
  first.send({ type: "input", data: "\x03" });
  first.send({ type: "input", data: "printf 'INTERRUPT_%s\\n' OK\r" });
  await until(() => first.output().includes("INTERRUPT_OK"), "Ctrl+C restores prompt");
  first.send({ type: "input", data: "printf '\\033[?1049h\\033[2J\\033[HALT_SCREEN_%s' OK\r" });
  await until(() => first.output().includes("ALT_SCREEN_OK"), "alternate screen");
  first.client.close();
  await once(first.client, "close");
  const second = await connect(session.id);
  const replay = second.messages.find((message) => message.type === "snapshot");
  assert.equal(replay.session.pid, session.pid);
  assert.ok(replay.data.includes("ALT_SCREEN_OK"), "current alternate screen survives reconnect");
  assert.ok(replay.data.includes("\x1b[?1049h"), "alternate screen mode restored");
  second.send({ type: "input", data: "printf '\\033[?1049l'; printf 'RESTORED_%s\\n' OK\r" });
  await until(() => second.output().includes("RESTORED_OK"), "input after reconnect");
  second.send({ type: "resize", cols: -1, rows: 0 });
  await until(
    () => second.messages.some((message) => message.type === "error"),
    "invalid resize rejected",
  );
  const other = await (await request("", "POST", { program: "shell" })).json();
  assert.notEqual(other.session.pid, session.pid);
  const reloaded = await import("../server/terminal.ts?reload-test");
  assert.equal(reloaded.listTerminalSessions(project.id).length, 2);
  const floodSession = await (await request("", "POST", { program: "shell" })).json();
  const flood = await connect(floodSession.session.id, false);
  flood.send({
    type: "input",
    data: "head -c 1572864 /dev/zero | tr '\\0' x; printf 'FLOOD_%s\\n' DONE\r",
  });
  const pending = () =>
    flood.messages
      .filter((message) => message.type === "output")
      .reduce((sum, message) => sum + message.data.length, 0);
  await until(() => pending() > 262144, "flow control high water mark");
  await pause(150);
  assert.ok(pending() < 1048576, "slow renderer bounds the output queue");
  flood.autoAck();
  flood.send({ type: "ack", length: pending() });
  await until(() => flood.output().includes("FLOOD_DONE"), "render acknowledgements resume output");
  assert.equal((await request(`/${floodSession.session.id}`, "DELETE")).status, 200);
  second.send({ type: "input", data: "exit 7\r" });
  await until(
    () =>
      second.messages.some(
        (message) =>
          message.type === "status" &&
          message.session.status === "exited" &&
          message.session.exitCode === 7,
      ),
    "exit status",
  );
  assert.equal((await request(`/${session.id}`, "DELETE")).status, 200);
  assert.equal((await request(`/${session.id}`, "DELETE")).status, 400);
  const running = await connect(other.session.id);
  running.send({
    type: "input",
    data: `bash -c 'trap "" TERM; sleep 60' & printf '%s' "$!" > '${join(root, "child-pid")}'\r`,
  });
  await until(
    () =>
      readFile(join(root, "child-pid"), "utf8")
        .then(Boolean)
        .catch(() => false),
    "background child started",
  );
  const childPid = Number(await readFile(join(root, "child-pid"), "utf8"));
  assert.equal((await request(`/${other.session.id}`, "DELETE")).status, 200);
  await until(async () => {
    const stat = await readFile(`/proc/${childPid}/stat`, "utf8").catch(() => "");
    return !stat || stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z ");
  }, "background child terminated");
  // Project commands use the same interactive PTY and reconnectable screen as shells.
  const { getSnapshot } = await import("../server/processes.ts");
  const run = (action, body) =>
    fetch(`${base}/api/projects/${project.id}/${action}`, {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  const started = await run("start", { commandId: "dev" });
  assert.equal(started.status, 200, await started.clone().text());
  const commandSession = listTerminalSessions(project.id).find((item) => item.commandId === "dev");
  assert.ok(commandSession);
  assert.equal(getSnapshot(project.id).pid, commandSession.pid);
  const commandTerminal = await connect(commandSession.id);
  await until(() => commandTerminal.output().includes("RUN_PTY"), "launch output in terminal");
  await until(
    () => getSnapshot(project.id).url === "http://localhost:43210/",
    "launch URL detected",
  );
  assert.equal(
    (await run("start", { commandId: "wait" })).status,
    400,
    "duplicate launch rejected",
  );
  commandTerminal.client.close();
  await once(commandTerminal.client, "close");
  const restoredCommand = await connect(commandSession.id);
  assert.ok(restoredCommand.output().includes("RUN_PTY"), "launch output survives reconnect");
  restoredCommand.send({ type: "input", data: "hello\r" });
  await until(
    () => restoredCommand.output().includes("INPUT_hello"),
    "launched command accepts input",
  );
  await until(() => getSnapshot(project.id).exitCode === 7, "launch exit code");
  assert.equal(getSnapshot(project.id).status, "error");
  assert.equal((await request(`/${commandSession.id}`, "DELETE")).status, 200);
  assert.equal((await run("start", { commandId: "wait" })).status, 200);
  const waitSession = listTerminalSessions(project.id).find((item) => item.commandId === "wait");
  assert.equal((await run("stop")).status, 200);
  await until(() => getSnapshot(project.id).status === "idle", "stop terminates command PTY");
  assert.equal(
    listTerminalSessions(project.id).find((item) => item.id === waitSession.id).status,
    "exited",
  );
  assert.equal((await request(`/${waitSession.id}`, "DELETE")).status, 200);
  assert.equal((await request("", "POST", { commandId: "missing" })).status, 400);
  assert.deepEqual(listTerminalSessions(project.id), []);
});

await test("terminal refuses foreign origins, DNS rebinding hosts, missing WebSocket origin and malformed sessions", async () => {
  // The previous test closes its server; use pure handshake checks on a fresh server.
  const probe = createServer((req, res) => {
    void handleApi(req, res);
  });
  attachTerminalServer(probe);
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const url = `http://127.0.0.1:${probe.address().port}`;
  try {
    const foreign = await fetch(`${url}/api/projects/x/terminals`, {
      headers: { Origin: "https://evil.example" },
    });
    assert.equal(foreign.status, 403);
    const rebind = await new Promise((resolve, reject) => {
      const req = httpRequest(
        `${url}/api/projects/x/terminals`,
        { headers: { Host: "evil.example" } },
        (res) => {
          resolve(res.statusCode);
          res.resume();
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(rebind, 403);
    for (const origin of [undefined, "https://evil.example", url]) {
      const client = new WebSocket(
        `${url.replace("http:", "ws:")}/api/terminal/socket?session=missing`,
        origin ? { origin } : {},
      );
      const response = await new Promise((resolve, reject) => {
        client.on("unexpected-response", (_req, res) => {
          resolve(res.statusCode);
          res.resume();
          client.terminate();
        });
        client.on("error", () => {});
        client.on("open", () => {
          client.terminate();
          reject(new Error("Unexpected successful handshake"));
        });
      });
      assert.equal(response, origin === url ? 404 : 403);
    }
  } finally {
    await new Promise((resolve) => probe.close(resolve));
  }
});
