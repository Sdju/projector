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
// Keep PTY probes independent of the runner's interactive shell startup files.
process.env.SHELL = join(root, "test-shell");
await writeFile(process.env.SHELL, '#!/bin/sh\nexec /bin/bash --noprofile --norc "$@"\n', {
  mode: 0o700,
});
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
const { attachTerminalControlServer } = await import("../server/modules/terminal-control/index.ts");
attachTerminalServer(server);
attachTerminalControlServer(server);
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
  await t.test(
    "WS project control: push, cross-client mutations, process protection and reconnect",
    async () => {
      async function control(projectId = project.id) {
        const client = new WebSocket(
          `${base.replace("http:", "ws:")}/api/terminal/control?project=${projectId}`,
          { origin: base },
        );
        sockets.add(client);
        const messages = [];
        client.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
        await once(client, "open");
        await until(() => messages.some((item) => item.type === "sessions"), "control snapshot");
        let id = 0;
        return {
          client,
          messages,
          latest: () => messages.filter((item) => item.type === "sessions").at(-1).sessions,
          async rpc(method, sessionId, body) {
            const requestId = ++id;
            client.send(JSON.stringify({ id: requestId, method, sessionId, body }));
            await until(() => messages.some((item) => item.id === requestId), "control response");
            return messages.find((item) => item.id === requestId).data;
          },
        };
      }
      const first = await control();
      const second = await control();
      const { session } = await first.rpc("POST", undefined, { program: "shell" });
      await until(
        () => second.latest().some((item) => item.id === session.id),
        "creation pushed to second client",
      );
      await second.rpc("POST", session.id, { action: "rename", title: "WS test" });
      await until(
        () => first.latest().some((item) => item.customTitle === "WS test"),
        "rename pushed to first client",
      );
      const screen = await connect(session.id);
      screen.send({ type: "input", data: "sleep 60\r" });
      await until(
        async () => (await first.rpc("GET", session.id)).session.activity.state === "busy",
        "foreground process",
      );
      const rejected = await first.rpc("DELETE", session.id);
      assert.equal(rejected.error, "Подтвердите прерывание процессов");
      assert.equal(rejected.session.id, session.id);
      await first.rpc("POST", session.id, { action: "stop" });
      await until(
        () => second.latest().some((item) => item.id === session.id && item.status === "exited"),
        "exit pushed",
      );
      const restarted = await first.rpc("POST", session.id, { action: "restart" });
      assert.notEqual(restarted.session.id, session.id);
      await until(
        () =>
          second.latest().some((item) => item.id === restarted.session.id) &&
          !second.latest().some((item) => item.id === session.id),
        "replacement pushed",
      );
      const current = await first.rpc("GET", restarted.session.id);
      assert.equal(
        (
          await first.rpc("DELETE", restarted.session.id, {
            confirmation: current.session.activity.confirmation,
          })
        ).ok,
        true,
      );
      await until(
        () => !second.latest().some((item) => item.id === restarted.session.id),
        "deletion pushed",
      );
      second.client.close();
      await once(second.client, "close");
      const restored = await control();
      assert.deepEqual(
        restored.latest().map((item) => item.id),
        listTerminalSessions(project.id).map((item) => item.id),
      );
      // HTTP compatibility changes also publish to every WS subscriber.
      const created = await request("", "POST", { program: "shell" });
      const external = (await created.json()).session;
      await until(
        () => restored.latest().some((item) => item.id === external.id),
        "HTTP creation pushed",
      );
      await request(`/${external.id}`, "DELETE");
      await until(
        () => !restored.latest().some((item) => item.id === external.id),
        "HTTP deletion pushed",
      );
      for (const subscriber of [first, restored]) subscriber.client.close();
    },
  );
  await t.test(
    "session model preserves restart placement and reconnects its WS subscription",
    async () => {
      const { createRenderer } = await import("vue");
      const { useTerminalSessions } = await import("../src/modules/terminal/model/sessions.ts");
      const keys = ["WebSocket", "location", "window", "sessionStorage"];
      const globals = keys.map((key) => [key, globalThis[key]]);
      const connections = [];
      globalThis.WebSocket = class extends WebSocket {
        constructor(url) {
          super(url, { origin: base });
          connections.push(this);
          sockets.add(this);
        }
      };
      globalThis.location = new URL(base);
      globalThis.window = new EventTarget();
      globalThis.sessionStorage = { getItem: () => null };
      const renderer = createRenderer({
        createComment: () => ({}),
        createText: () => ({}),
        createElement: () => ({}),
        insert() {},
        remove() {},
        setText() {},
        setElementText() {},
        patchProp() {},
        parentNode: () => null,
        nextSibling: () => null,
      });
      let model;
      let replacedBeforeList;
      const app = renderer.createApp({
        setup() {
          model = useTerminalSessions(() => project.id, {
            restarted(previousId) {
              replacedBeforeList = model.sessions.value.some((item) => item.id === previousId);
            },
          });
          return () => null;
        },
      });
      app.mount({});
      try {
        await until(() => model.loaded.value, "model WS snapshot");
        const created = await model.create("shell");
        assert.ok(created);
        assert.equal(model.sessions.value.filter((item) => item.id === created.id).length, 1);
        await model.stop(created.id);
        await until(
          () => model.sessions.value.find((item) => item.id === created.id)?.status === "exited",
          "model exit",
        );
        await model.restart(created.id);
        assert.equal(model.error.value, "");
        assert.equal(
          replacedBeforeList,
          true,
          "restart hook runs before pushed list removes previous panel",
        );
        const fresh = model.sessions.value.find((item) => item.id !== created.id);
        assert.ok(fresh);
        connections.at(-1).terminate();
        await until(
          () => connections.length === 2 && connections.at(-1).readyState === WebSocket.OPEN,
          "automatic reconnect",
        );
        const external = (await (await request("", "POST", { program: "shell" })).json()).session;
        await until(
          () => model.sessions.value.some((item) => item.id === external.id),
          "push after reconnect",
        );
        await request(`/${fresh.id}`, "DELETE");
        await request(`/${external.id}`, "DELETE");
        await until(() => model.sessions.value.length === 0, "model deletion push");
      } finally {
        app.unmount();
        for (const [key, value] of globals) {
          if (value === undefined) delete globalThis[key];
          else globalThis[key] = value;
        }
      }
    },
  );
  await t.test(
    "OpenCode uses project cwd and an interactive PTY, reconnects and restarts",
    async () => {
      const bin = join(root, "bin");
      await mkdir(bin);
      await writeFile(
        join(bin, "opencode"),
        '#!/bin/sh\ntest -t 0 && test -t 1 || exit 1\nprintf "OPENCODE_READY:%s\\n" "$PWD"\nread value\nprintf "OPENCODE_INPUT:%s\\n" "$value"\n',
        { mode: 0o700 },
      );
      const previousPath = process.env.PATH;
      process.env.PATH = `${bin}:${previousPath}`;
      try {
        const created = await request("", "POST", { program: "opencode" });
        assert.equal(created.status, 201, await created.clone().text());
        const { session } = await created.json();
        assert.equal(session.program, "opencode");
        assert.equal(session.title, "OpenCode");
        const first = await connect(session.id);
        await until(
          () => first.output().includes(`OPENCODE_READY:${root}`),
          "OpenCode PTY and cwd",
        );
        first.client.close();
        await once(first.client, "close");
        const reconnected = await connect(session.id);
        assert.ok(reconnected.output().includes(`OPENCODE_READY:${root}`));
        reconnected.send({ type: "input", data: "привет OpenCode\r" });
        await until(
          () => reconnected.output().includes("OPENCODE_INPUT:привет OpenCode"),
          "OpenCode input",
        );
        await until(
          () =>
            listTerminalSessions(project.id).find((item) => item.id === session.id)?.exitCode === 0,
          "OpenCode exit",
        );
        const restarted = await request(`/${session.id}`, "POST", { action: "restart" });
        assert.equal(restarted.status, 201, await restarted.clone().text());
        const fresh = (await restarted.json()).session;
        assert.equal(fresh.program, "opencode");
        assert.equal(fresh.title, "OpenCode");
        const output = await connect(fresh.id);
        await until(() => output.output().includes(`OPENCODE_READY:${root}`), "OpenCode restart");
        assert.equal((await request(`/${fresh.id}`, "DELETE")).status, 200);
      } finally {
        process.env.PATH = previousPath;
      }
    },
  );
  const droppedSession = (await (await request("", "POST", { program: "shell" })).json()).session;
  const uploadUrl = `${base}/api/projects/${project.id}/terminals/${droppedSession.id}`;
  const content = Buffer.from([0, 255, 10, 13, 65]);
  const upload = (name, extra = {}) =>
    fetch(`${uploadUrl}?name=${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { Origin: base, "Content-Type": "application/octet-stream", ...extra },
      body: content,
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
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "nested/local.ts"), "const local = true;\n");
  await writeFile(join(root, "root.md"), "# Root\n");
  first.send({ type: "input", data: "cd nested; printf 'LINK_CWD_%s\\n' READY\r" });
  await until(() => first.output().includes("LINK_CWD_READY"), "shell changed cwd for links");
  const linkRequest = (path) => request(`/${session.id}?${new URLSearchParams({ link: path })}`);
  assert.deepEqual(await (await linkRequest("local.ts")).json(), {
    path: "nested/local.ts",
    external: false,
  });
  assert.deepEqual(await (await linkRequest("root.md")).json(), {
    path: "root.md",
    external: false,
  });
  assert.equal((await linkRequest("missing.ts")).status, 404);
  assert.equal(
    (
      await request(`/${session.id}?link=local.ts`, "GET", undefined, {
        Origin: "https://evil.example",
      })
    ).status,
    403,
  );
  assert.equal((await request("/missing-session?link=local.ts")).status, 404);
  first.send({ type: "input", data: "cd ..; printf 'LINK_BACK_%s\\n' READY\r" });
  await until(() => first.output().includes("LINK_BACK_READY"), "restore shell cwd after links");
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
  attachTerminalControlServer(probe);
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
    for (const endpoint of ["socket?session=missing", "control?project=missing"])
      for (const origin of [undefined, "https://evil.example", url]) {
        const client = new WebSocket(
          `${url.replace("http:", "ws:")}/api/terminal/${endpoint}`,
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
