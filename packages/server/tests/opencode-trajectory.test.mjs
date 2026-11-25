import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout } from "node:timers/promises";
import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { dataDir } from "../../core/modules/app-paths/index.ts";
import { handleApi } from "../app/api.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "projector-opencode-trajectory-"));
  const previous = process.env.XDG_DATA_HOME;
  const project = join(root, "project");
  const other = join(project, "other");
  const stored = join(root, "opencode");
  process.env.XDG_DATA_HOME = root;
  const server = createServer((req, res) => void handleApi(req, res));
  onTestFinished(async () => {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(root, { recursive: true, force: true });
  });

  await Promise.all([other, stored, dataDir()].map((path) => mkdir(path, { recursive: true })));
  await writeFile(
    join(dataDir(), "projects.json"),
    JSON.stringify({
      projects: [
        { id: "main", name: "Main", path: project, commands: [] },
        { id: "other", name: "Other", path: other, commands: [] },
      ],
    }),
  );
  const file = join(stored, "opencode.db");
  const db = new DatabaseSync(file);
  try {
    db.exec(`
      CREATE TABLE session_v2 (id TEXT PRIMARY KEY, directory TEXT, title TEXT, model TEXT);
      CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT);
      CREATE TABLE session_message (session_id TEXT, seq INTEGER, type TEXT, time_created INTEGER, data TEXT);
    `);
    const add = db.prepare("INSERT INTO session_v2 VALUES (?, ?, 'Session', NULL)");
    add.run("main-session", project);
    add.run("other-session", other);
    add.run("worktree-session", join(dataDir(), "worktrees", "main-0123abcd", "nested"));
    add.run("neighbor-copy", join(dataDir(), "worktrees", "main-extra-0123abcd"));
    db.prepare("INSERT INTO session VALUES (?, ?)").run("legacy-other", other);
    db.prepare("INSERT INTO session VALUES (?, ?)").run("legacy-main", project);
    const addMessage = db.prepare("INSERT INTO session_message VALUES (?, ?, ?, ?, ?)");
    const baseTime = 1_760_000_000_000;
    const put = (sequence, type, value, session = "main-session") =>
      addMessage.run(session, sequence, type, baseTime + sequence * 1_000, JSON.stringify(value));
    put(1, "user", { text: "Question" });
    put(2, "compaction", { status: "completed", tokens: { input: 20, output: 5 }, cost: 0.01 });
    put(3, "assistant", {
      time: { created: baseTime + 2_100, streamed: baseTime + 2_200, completed: baseTime + 2_400 },
      tokens: { input: 40, output: 10 },
      cost: 0.02,
    });
    put(4, "idle", { outcome: "succeeded" });
    put(5, "user", { text: "Next question" });
    put(6, "assistant", {
      time: { created: baseTime + 5_500 },
      content: [
        { type: "tool", id: "running-tool", name: "example", state: { status: "running" } },
      ],
    });
    put(7, "idle", { outcome: "interrupted" });
    put(1, "user", { text: "Worktree question" }, "worktree-session");
  } finally {
    db.close();
  }

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const trajectory = (sessionId, { projectId = "main", format } = {}) =>
    fetch(`${base}/api/opencode/trajectory`, {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, sessionId, format }),
    });
  return { base, file, server, trajectory };
}

test("the HTTP trajectory contains one copy of records, usage for compaction and settled tools", async () => {
  const { trajectory } = await fixture();
  const response = await trajectory("main-session");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const { data } = await response.json();
  expect(data).not.toHaveProperty("records");
  expect(data.capabilities.live).toBe(false);
  expect(data.turns[0].records).toContainEqual(
    expect.objectContaining({ kind: "compaction", usage: { input: 20, output: 5, cost: 0.01 } }),
  );
  expect(data.turns[0].records).toContainEqual(
    expect.objectContaining({ timing: { ttftMs: 100, decodingMs: 200 } }),
  );
  expect(data.turns[1]).toMatchObject({
    status: "stopped",
    records: [
      { kind: "user", status: "done" },
      { kind: "assistant", status: "stopped" },
      { kind: "tool", status: "stopped", tool: { status: "stopped", endedAt: 1_760_000_007_000 } },
    ],
  });
});

test("the HTTP trajectory only accepts the project's folder and its own worktrees", async () => {
  const { trajectory } = await fixture();
  const cases = [
    ["main-session", { projectId: "missing" }, 404],
    ["other-session", {}, 404],
    ["other-session", { format: "turns" }, 404],
    ["legacy-other", {}, 404],
    ["legacy-other", { format: "turns" }, 404],
    ["legacy-main", {}, 422],
    ["neighbor-copy", {}, 404],
    ["worktree-session", {}, 200],
  ];
  await Promise.all(
    cases.map(async ([session, options, status]) => {
      const response = await trajectory(session, options);
      await response.text();
      expect(response.status, session).toBe(status);
    }),
  );
});

test("HTTP remains responsive while the trajectory's worker waits for SQLite", async () => {
  const { base, file, server, trajectory } = await fixture();
  const locked = new DatabaseSync(file);
  locked.exec("BEGIN EXCLUSIVE");
  let release;
  const received = new Promise((resolve) => {
    release = resolve;
  });
  server.once("request", release);
  const waiting = trajectory("main-session");
  const reply = vi.fn();
  void waiting.then(reply, reply);
  try {
    await received;
    // Keep the lock across worker startup and the first SQLite read.
    await setTimeout(100);
    const health = await fetch(`${base}/api/health`);
    expect(health.ok).toBe(true);
    await health.text();
    expect(reply).not.toHaveBeenCalled();
  } finally {
    locked.close();
  }
  const response = await waiting;
  expect(response.status).toBe(200);
  await response.text();
});
