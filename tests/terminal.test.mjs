import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { WebSocket } from "ws";
import headless from "@xterm/headless";
import serialization from "@xterm/addon-serialize";
import { trackMouseEncoding } from "../server/modules/terminal/index.ts";

await test("mouse encoding survives snapshots, fragmented modes, disable, RIS and retained sessions", async () => {
  const screen = new headless.Terminal({ allowProposedApi: true });
  const addon = new serialization.SerializeAddon();
  screen.loadAddon(addon);
  const write = (terminal, data) => new Promise((resolve) => terminal.write(data, resolve));
  await write(screen, "\x1b[?1000h\x1b[?1006h");
  const mouse = trackMouseEncoding(screen);
  await write(screen, "");
  assert.equal(mouse.serialize(), "\x1b[?1006h", "discover retained SGR mode");
  for (const [sequence, mode] of [
    ["", 1006],
    ["\x1b[?1002;1016h", 1016],
    ["\x1b[?1016l", null],
    ["\x1b[?1006;1016h", 1016],
    ["\x1b[?1006l", null],
    ["\x1b[?1006h\x1bc", null],
    ["\x1b[?1003;1006h", 1006],
  ]) {
    for (const char of sequence) await write(screen, char);
    const restored = new headless.Terminal({ allowProposedApi: true });
    await write(restored, addon.serialize() + mouse.serialize());
    const reports = [];
    restored.onData((data) => reports.push(data));
    await write(restored, "\x1b[?1006$p\x1b[?1016$p");
    assert.deepEqual(reports, [
      `\x1b[?1006;${mode === 1006 ? 1 : 2}$y`,
      `\x1b[?1016;${mode === 1016 ? 1 : 2}$y`,
    ]);
    assert.equal(restored.modes.mouseTrackingMode, screen.modes.mouseTrackingMode);
    restored.dispose();
  }
  screen.dispose();
});

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
const { handleApi } = await import("../server/app/api.ts");
const { attachTerminalServer, listTerminalSessions, closeTerminalSession } =
  await import("../server/modules/terminal/index.ts");
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
  if (method === "DELETE" && body === undefined) {
    const current = await request(suffix);
    if (current.ok) body = { confirmation: (await current.json()).session.activity.confirmation };
  }
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
  const droppedSession = (await (await request("", "POST", { program: "shell" })).json()).session;
  const uploadUrl = `${base}/api/projects/${project.id}/terminals/${droppedSession.id}`;
  const content = Buffer.from([0, 255, 10, 13, 65]);
  const upload = (name, extra = {}) => fetch(`${uploadUrl}?name=${encodeURIComponent(name)}`, {
    method: "PUT", headers: { Origin: base, "Content-Type": "application/octet-stream", ...extra }, body: content,
  });
  assert.equal((await upload("../escape")).status, 400);
  assert.equal((await upload("file", { Origin: "https://evil.example" })).status, 403);
  const uploaded = await upload("файл с ' пробелами.bin");
  assert.equal(uploaded.status, 201, await uploaded.clone().text());
  const { path: uploadedPath } = await uploaded.json();
  assert.deepEqual(await readFile(uploadedPath), content);
  await request(`/${droppedSession.id}`, "DELETE");
  await assert.rejects(readFile(uploadedPath), { code: "ENOENT" });
  const create = await request("", "POST", { program: "shell", cols: 90, rows: 30 });
  assert.equal(create.status, 201, await create.clone().text());
  const { session } = await create.json();
  const first = await connect(session.id);
  const mouseBytes = Buffer.from([27, 91, 77, 32, 143, 43]);
  const unicodeBytes = Buffer.from("привет🙂");
  const expectedBytes = Buffer.concat([mouseBytes, unicodeBytes]);
  await writeFile(
    join(root, "read-input.py"),
    `import os, termios, tty
saved = termios.tcgetattr(0)
try:
 tty.setraw(0)
 os.write(1, b'RAW_READY')
 data = b''
 while len(data) < ${expectedBytes.length}:
  data += os.read(0, ${expectedBytes.length} - len(data))
finally:
 termios.tcsetattr(0, termios.TCSANOW, saved)
print('RAW_HEX=' + data.hex(), flush=True)
`,
  );
  first.send({ type: "input", data: "python3 read-input.py\r" });
  await until(() => first.output().includes("RAW_READY"), "raw PTY reader");
  first.send({ type: "input", data: mouseBytes.toString("latin1"), encoding: "binary" });
  first.send({ type: "input", data: "привет🙂" });
  await until(
    () => first.output().includes(`RAW_HEX=${expectedBytes.toString("hex")}`),
    "exact mouse bytes and UTF-8 Russian input",
  );
  first.send({ type: "input", data: "п", encoding: "binary" });
  first.send({ type: "input", data: "text", encoding: "unknown" });
  await until(
    () => first.messages.filter((message) => message.type === "error").length === 2,
    "invalid byte input rejected",
  );
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
  first.send({
    type: "input",
    data: "printf '\\033[?1049h\\033[?1000h\\033[?1006h\\033[2J\\033[HALT_SCREEN_%s' OK\r",
  });
  await until(() => first.output().includes("ALT_SCREEN_OK"), "alternate screen");
  first.client.close();
  await once(first.client, "close");
  const second = await connect(session.id);
  const replay = second.messages.find((message) => message.type === "snapshot");
  assert.equal(replay.session.pid, session.pid);
  assert.ok(replay.data.includes("ALT_SCREEN_OK"), "current alternate screen survives reconnect");
  assert.ok(replay.data.includes("\x1b[?1049h"), "alternate screen mode restored");
  assert.ok(replay.data.includes("\x1b[?1000h"), "mouse tracking restored");
  assert.ok(replay.data.endsWith("\x1b[?1006h"), "SGR mouse encoding restored");
  second.send({ type: "input", data: "printf '\\033[?1049l'; printf 'RESTORED_%s\\n' OK\r" });
  await until(() => second.output().includes("RESTORED_OK"), "input after reconnect");
  second.send({ type: "resize", cols: -1, rows: 0 });
  await until(
    () => second.messages.some((message) => message.type === "error"),
    "invalid resize rejected",
  );
  const other = await (await request("", "POST", { program: "shell" })).json();
  assert.notEqual(other.session.pid, session.pid);
  const reloaded = await import("../server/modules/terminal/terminal.ts?reload-test");
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
  const { getSnapshot } = await import("../server/modules/processes/index.ts");
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
  const commandRestart = await request(`/${commandSession.id}`, "POST", { action: "restart" });
  assert.equal(commandRestart.status, 201, await commandRestart.clone().text());
  const restartedCommand = (await commandRestart.json()).session;
  assert.equal(restartedCommand.commandId, "dev");
  assert.notEqual(restartedCommand.id, commandSession.id);
  assert.equal(getSnapshot(project.id).pid, restartedCommand.pid);
  assert.equal(getSnapshot(project.id).status, "running");
  assert.ok(!listTerminalSessions(project.id).some((item) => item.id === commandSession.id));
  assert.equal(
    (await request(`/${restartedCommand.id}`, "POST", { action: "restart" })).status,
    409,
  );
  const restartedOutput = await connect(restartedCommand.id);
  await until(
    () => restartedOutput.output().includes("RUN_PTY"),
    "command restart preserves launch recipe",
  );
  assert.equal((await request(`/${restartedCommand.id}`, "POST", { action: "stop" })).status, 200);
  await until(
    () => getSnapshot(project.id).status === "idle",
    "terminal stop updates project status",
  );
  assert.equal(
    listTerminalSessions(project.id).find((item) => item.id === restartedCommand.id).stopRequested,
    true,
  );
  assert.equal((await request(`/${restartedCommand.id}`, "DELETE")).status, 200);
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
  const shell = (
    await (await request("", "POST", { program: "shell", cols: 100, rows: 30 })).json()
  ).session;
  const shellOutput = await connect(shell.id);
  await until(
    async () => (await (await request(`/${shell.id}`)).json()).session.activity.state === "idle",
    "Bash prompt is idle",
  );
  shellOutput.send({ type: "input", data: "sleep 60\r" });
  await until(
    async () =>
      (await (await request(`/${shell.id}`)).json()).session.activity.processes.some(
        (item) => item.name === "sleep",
      ),
    "foreground process is busy",
  );
  assert.equal((await request(`/${shell.id}`, "DELETE", {})).status, 409);
  shellOutput.send({ type: "input", data: "\u0003" });
  await until(
    async () => (await (await request(`/${shell.id}`)).json()).session.activity.state === "idle",
    "shell idles after foreground job stops",
  );
  shellOutput.send({ type: "input", data: "sleep 60 &\r" });
  await until(
    async () =>
      (await (await request(`/${shell.id}`)).json()).session.activity.processes.some(
        (item) => item.name === "sleep",
      ),
    "background process is busy even at a prompt",
  );
  const blockedWork = await request(`/${shell.id}`, "DELETE", {});
  assert.equal(blockedWork.status, 409);
  const oldConfirmation = (await blockedWork.json()).session.activity.confirmation;
  assert.equal((await request(`/${shell.id}`, "DELETE", { confirmation: "invalid" })).status, 409);
  shellOutput.send({ type: "input", data: "sleep 60 &\r" });
  await until(
    async () =>
      (await (await request(`/${shell.id}`)).json()).session.activity.processes.filter(
        (item) => item.name === "sleep",
      ).length === 2,
    "a new process invalidates approval",
  );
  assert.equal(
    (await request(`/${shell.id}`, "DELETE", { confirmation: oldConfirmation })).status,
    409,
  );
  shellOutput.send({ type: "input", data: "kill $(jobs -p)\r" });
  await until(
    async () => (await (await request(`/${shell.id}`)).json()).session.activity.state === "idle",
    "shell idles after background jobs stop",
  );

  shellOutput.send({ type: "input", data: "printf 'KEPT_OUTPUT\\n'\r" });
  await until(() => shellOutput.output().includes("KEPT_OUTPUT"), "shell stop probe output");
  assert.equal((await request(`/${shell.id}`, "POST", { action: "stop" })).status, 200);
  await until(
    () =>
      listTerminalSessions(project.id).find((item) => item.id === shell.id)?.status === "exited",
    "shell stops without deleting tab",
  );
  const retained = await connect(shell.id);
  assert.ok(
    retained.output().includes("KEPT_OUTPUT"),
    "stopped session retains output on reconnect",
  );
  assert.equal(
    (await request(`/${shell.id}`, "POST", { action: "stop" })).status,
    200,
    "stop is idempotent",
  );
  const renamed = await request(`/${shell.id}`, "POST", {
    action: "rename",
    title: "  Build logs  ",
  });
  assert.equal(renamed.status, 200);
  assert.equal((await renamed.json()).session.customTitle, "Build logs");
  assert.equal((await (await request(`/${shell.id}`)).json()).session.customTitle, "Build logs");
  for (const title of ["", "   ", "x".repeat(81), 42])
    assert.equal((await request(`/${shell.id}`, "POST", { action: "rename", title })).status, 400);
  const neighbor = (await (await request("", "POST", { program: "shell" })).json()).session;
  const restart = await request(`/${shell.id}`, "POST", { action: "restart" });
  assert.equal(restart.status, 201, await restart.clone().text());
  const fresh = (await restart.json()).session;
  assert.deepEqual(
    listTerminalSessions(project.id).map((item) => item.id),
    [fresh.id, neighbor.id],
    "restart retains tab order",
  );
  assert.equal((await request(`/${neighbor.id}`, "DELETE")).status, 200);
  assert.equal(fresh.customTitle, "Build logs", "restart retains custom tab name");
  assert.equal(fresh.program, "shell");
  assert.equal(fresh.status, "running");
  assert.equal(fresh.cols, 100);
  assert.equal(fresh.rows, 30);
  assert.equal(fresh.stopRequested, undefined);
  assert.ok(!listTerminalSessions(project.id).some((item) => item.id === shell.id));
  assert.equal((await request(`/${fresh.id}`, "POST", { action: "invalid" })).status, 400);
  assert.equal((await request("/missing", "POST", { action: "restart" })).status, 404);
  const freshOutput = await connect(fresh.id);
  freshOutput.send({ type: "input", data: "exit 0\r" });
  await until(
    () => listTerminalSessions(project.id).find((item) => item.id === fresh.id)?.exitCode === 0,
    "restarted shell accepts input and exits successfully",
  );
  assert.equal((await request(`/${fresh.id}`, "DELETE")).status, 200);
  const idleShell = (await (await request("", "POST", { program: "shell" })).json()).session;
  await until(
    async () =>
      (await (await request(`/${idleShell.id}`)).json()).session.activity.state === "idle",
    "another idle Bash prompt",
  );
  assert.equal(
    (await request(`/${idleShell.id}`, "DELETE", {})).status,
    200,
    "idle shell closes without confirmation",
  );
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
