import { test, expect } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocket } from "ws";
import { runInNewContext } from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import { MessageChannel } from "node:worker_threads";

const root = await mkdtemp(join(tmpdir(), "projector-shared-test-"));
process.env.XDG_DATA_HOME = root;
await mkdir(join(root, "projector"));
if (process.platform !== "win32") {
  process.env.SHELL = join(root, "shell");
  await writeFile(process.env.SHELL, '#!/bin/sh\nexec /bin/bash --noprofile --norc "$@"\n', {
    mode: 0o700,
  });
}
const project = {
  id: "shared-probe",
  name: "Shared probe",
  path: root,
  commands: [],
  createdAt: "",
};
await writeFile(join(root, "projector/projects.json"), JSON.stringify({ projects: [project] }));
const { attachSharedTerminalServer } = await import("../server/modules/terminal-control/index.ts");
const { attachTerminalServer, createTerminalSession, closeProjectTerminals, listTerminalSessions } =
  await import("../server/modules/terminal/index.ts");
const { state } = await import("../server/modules/terminal/session-state.ts");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate) {
  for (let i = 0; i < 400; i++) {
    if (predicate()) return;
    await wait(25);
  }
  expect.fail("Timed out waiting for terminal transport");
}

test("shared channels preserve PTY, ACK, resize, reconnect, control isolation and legacy coexistence", async () => {
  const server = createServer((_req, res) => res.end("ok"));
  attachTerminalServer(server);
  attachSharedTerminalServer(server);
  // Attaching twice must not duplicate upgrade handlers.
  attachSharedTerminalServer(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const base = origin.replace("http:", "ws:");
  const sockets = [];
  async function connect(path) {
    const ws = new WebSocket(base + path, { origin });
    sockets.push(ws);
    const messages = [];
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    await once(ws, "open");
    return { ws, messages, send: (message) => ws.send(JSON.stringify(message)) };
  }
  try {
    const a = createTerminalSession(project, { program: "shell" });
    const b = createTerminalSession(project, { program: "shell" });
    const data = await connect("/api/terminal/shared?kind=data");
    const control = await connect("/api/terminal/shared?kind=control");
    const open = (client, channel, sessionId, projectId = project.id) =>
      client.send({ type: "open", channel, projectId, sessionId });
    const payloads = (client, channel) =>
      client.messages
        .filter((item) => item.channel === channel && item.type === "message")
        .map((item) => JSON.parse(item.data));
    const output = (channel) =>
      payloads(data, channel)
        .map((item) => item.data ?? "")
        .join("");
    open(data, "a", a.id);
    open(data, "b", b.id);
    open(data, "a-second-view", a.id);
    open(control, "project");
    await until(() =>
      ["a", "b", "a-second-view"].every((channel) =>
        payloads(data, channel).some((item) => item.type === "snapshot"),
      ),
    );
    await until(() => payloads(control, "project").some((item) => item.type === "sessions"));
    const send = (channel, message) =>
      data.send({ type: "send", channel, data: JSON.stringify(message) });
    send("a", { type: "input", data: "printf 'SHARED_%s\\n' INPUT\r" });
    send("b", { type: "input", data: "printf 'OTHER_%s\\n' TERMINAL\r" });
    await until(
      () => output("a").includes("SHARED_INPUT") && output("b").includes("OTHER_TERMINAL"),
    );
    expect(output("b")).not.toContain("SHARED_INPUT");
    await until(() => state.sessions.get(a.id).pending.size === 2);
    const pendingA = state.sessions.get(a.id).pending;
    expect([...pendingA.values()].every((length) => length > 0)).toBe(true);
    for (const channel of ["a", "a-second-view"]) {
      const length = payloads(data, channel)
        .filter((item) => item.type === "output")
        .reduce((sum, item) => sum + item.data.length, 0);
      send(channel, { type: "ack", length });
    }
    await until(() => [...pendingA.values()].every((length) => length === 0));
    send("b", { type: "resize", cols: 91, rows: 29 });
    await until(() =>
      payloads(data, "b").some((item) => item.type === "status" && item.session.cols === 91),
    );
    control.send({
      type: "send",
      channel: "project",
      data: JSON.stringify({
        id: 1,
        method: "POST",
        sessionId: b.id,
        body: { action: "rename", title: "Shared rename" },
      }),
    });
    await until(() =>
      payloads(control, "project").some((item) => item.type === "response" && item.id === 1),
    );
    expect(listTerminalSessions(project.id).find((item) => item.id === b.id).customTitle).toBe(
      "Shared rename",
    );
    open(control, "missing", undefined, "missing-project");
    await until(() =>
      control.messages.some((item) => item.channel === "missing" && item.type === "closed"),
    );
    // Data subscription can only access terminals belonging to its project.
    open(data, "foreign", a.id, "missing-project");
    await until(() =>
      data.messages.some((item) => item.channel === "foreign" && item.type === "closed"),
    );
    expect(payloads(data, "foreign")).toEqual([]);
    const legacy = await connect(`/api/terminal/socket?session=${a.id}`);
    await until(() => legacy.messages.some((item) => item.type === "snapshot"));
    const pid = a.pid;
    data.send({ type: "close", channel: "a" });
    await until(() => state.sessions.get(a.id).clients.size === 2);
    open(data, "a-restored", a.id);
    await until(() =>
      payloads(data, "a-restored").some(
        (item) => item.type === "snapshot" && item.data.includes("SHARED_INPUT"),
      ),
    );
    expect(state.sessions.get(a.id).info.pid).toBe(pid);
    data.ws.terminate();
    await until(() => state.sessions.get(a.id).clients.size === 1);
    legacy.ws.send(JSON.stringify({ type: "input", data: "printf 'LEGACY_%s\\n' ALIVE\r" }));
    await until(() =>
      legacy.messages.some((item) => item.type === "output" && item.data.includes("LEGACY_ALIVE")),
    );
    expect((await fetch(origin)).status).toBe(200);
    // Execute the actual worker with real MessagePorts and WS. Only its lease clock is controlled.
    const scope = {};
    let now = 0;
    let leaseTick;
    class BrowserSocket extends WebSocket {
      constructor(url) {
        super(url, { origin });
      }
    }
    const workerSource = await readFile(
      new URL("../src/modules/terminal/lib/shared.worker.ts", import.meta.url),
      "utf8",
    );
    runInNewContext(stripTypeScriptTypes(workerSource), {
      self: scope,
      WebSocket: BrowserSocket,
      URL,
      Date: { now: () => now },
      setInterval: (callback) => {
        leaseTick = callback;
      },
    });
    const { port1, port2 } = new MessageChannel();
    const leaseMessages = [];
    port2.on("message", (message) => leaseMessages.push(message));
    scope.onconnect({ ports: [port1] });
    const leaseOpen = (channel, sessionId) =>
      port2.postMessage({
        type: "open",
        channel,
        projectId: project.id,
        sessionId,
        url: `${base}/api/terminal/${sessionId ? "socket" : "control"}?project=${project.id}`,
      });
    try {
      leaseOpen("lease-control");
      leaseOpen("lease-data", a.id);
      await until(() => leaseMessages.filter((message) => message.type === "opened").length === 2);
      now = 120001;
      leaseTick();
      await until(() => leaseMessages.filter((message) => message.type === "closed").length === 2);
      expect(state.sessions.get(a.id).info.pid).toBe(pid);
      // A resumed frozen page must be able to subscribe again, not retain stranded OPEN channels.
      leaseOpen("resumed-control");
      leaseOpen("resumed-data", a.id);
      await until(() => leaseMessages.filter((message) => message.type === "opened").length === 4);
    } finally {
      port2.postMessage({ type: "release" });
      await wait(50);
      port1.close();
      port2.close();
    }
    // Closing a terminal closes only that logical channel, never the physical WS.
    const restored = await connect("/api/terminal/shared?kind=data");
    open(restored, "closed-terminal", b.id);
    await until(() =>
      payloads(restored, "closed-terminal").some((item) => item.type === "snapshot"),
    );
    const { closeTerminalSession } = await import("../server/modules/terminal/index.ts");
    closeTerminalSession(project.id, b.id);
    await until(() =>
      restored.messages.some(
        (item) =>
          item.type === "closed" && item.channel === "closed-terminal" && item.code === 1000,
      ),
    );
    expect(restored.ws.readyState).toBe(WebSocket.OPEN);
  } finally {
    for (const ws of sockets) ws.terminate();
    closeProjectTerminals(project.id);
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
