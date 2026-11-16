import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  openCodeDatabasePath,
  openCodeIdleOutcomes,
  openCodeSessionMeta,
  withOpenCodeBranches,
} from "../modules/agents/opencode/sessions.ts";

/** Creates an OpenCode database with the given session table and rows. */
async function database(directory, table, rows) {
  await mkdir(join(directory, "opencode"), { recursive: true });
  const db = new DatabaseSync(join(directory, "opencode", "opencode.db"));
  db.exec(
    `CREATE TABLE ${table} (id TEXT PRIMARY KEY, parent_id TEXT, agent TEXT); CREATE INDEX ${table}_parent ON ${table} (parent_id);`,
  );
  const insert = db.prepare(`INSERT INTO ${table} (id, parent_id, agent) VALUES (?, ?, ?)`);
  for (const row of rows) insert.run(row.id, row.parent ?? null, row.agent ?? null);
  db.close();
}

describe("OpenCode subagent sessions are read from the agent's own database", () => {
  let previous, root;
  beforeAll(async () => {
    previous = process.env.XDG_DATA_HOME;
    root = await mkdtemp(join(tmpdir(), "projector-opencode-sessions-"));
  });
  afterAll(async () => {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(root, { recursive: true, force: true });
  });

  test("parent and agent come from session_v2; a plain session has no branch", async () => {
    const directory = join(root, "v2");
    await database(directory, "session_v2", [
      { id: "ses_main", agent: "build" },
      { id: "ses_child", parent: "ses_main", agent: "explore" },
    ]);
    process.env.XDG_DATA_HOME = directory;
    expect(openCodeDatabasePath()).toBe(join(directory, "opencode", "opencode.db"));
    const meta = await openCodeSessionMeta(["ses_main", "ses_child", "ses_absent"]);
    expect(meta.get("ses_child")).toStrictEqual({ parent: "ses_main", agent: "explore" });
    expect(meta.get("ses_main")).toStrictEqual({ agent: "build" });
    expect(meta.has("ses_absent")).toBe(false);
  });

  test("the older session table is used when session_v2 is absent", async () => {
    const directory = join(root, "legacy");
    await database(directory, "session", [{ id: "ses_child", parent: "ses_parent" }]);
    process.env.XDG_DATA_HOME = directory;
    expect(await openCodeSessionMeta(["ses_child"])).toStrictEqual(
      new Map([["ses_child", { parent: "ses_parent" }]]),
    );
  });

  test("a missing or unreadable database leaves the agent's list untouched", async () => {
    process.env.XDG_DATA_HOME = join(root, "missing");
    const sessions = [{ id: "ses_child", title: "Branch" }];
    expect(await openCodeSessionMeta(["ses_child"])).toStrictEqual(new Map());
    expect(await withOpenCodeBranches(sessions)).toBe(sessions);
  });

  test("branches keep the title the agent reported and their own parent wins", async () => {
    const directory = join(root, "merge");
    await database(directory, "session_v2", [
      { id: "ses_child", parent: "ses_main", agent: "general" },
      { id: "ses_known", parent: "ses_wrong", agent: "general" },
      { id: "ses_build", agent: "build" },
    ]);
    process.env.XDG_DATA_HOME = directory;
    const sessions = [
      { id: "ses_main", title: "Main chat" },
      { id: "ses_child", title: "Audit tests" },
      { id: "ses_known", title: "Known branch", parent: "ses_right" },
      { id: "ses_build", title: "Build chat" },
    ];
    expect(await withOpenCodeBranches(sessions)).toStrictEqual([
      { id: "ses_main", title: "Main chat" },
      { id: "ses_child", title: "Audit tests", parent: "ses_main", agent: "general" },
      { id: "ses_known", title: "Known branch", parent: "ses_right", agent: "general" },
      // A chat's own agent is its mode, not a subagent: it stays unmarked.
      { id: "ses_build", title: "Build chat" },
    ]);
  });
});

describe("OpenCode idle outcomes tell a finished child from a working one", () => {
  let previous, root;
  beforeAll(async () => {
    previous = process.env.XDG_DATA_HOME;
    root = await mkdtemp(join(tmpdir(), "projector-opencode-idle-"));
  });
  afterAll(async () => {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(root, { recursive: true, force: true });
  });

  /** Creates a database whose session table has the given extra columns. */
  async function idleDatabase(directory, table, columns) {
    await mkdir(join(directory, "opencode"), { recursive: true });
    const db = new DatabaseSync(join(directory, "opencode", "opencode.db"));
    db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, ${columns});`);
    return db;
  }

  test("a working child is not stopped by its queue claim, only by idle_outcome", async () => {
    const directory = join(root, "v2");
    const db = await idleDatabase(
      directory,
      "session_v2",
      "time_suspended INTEGER, idle_outcome TEXT",
    );
    db.exec(`INSERT INTO session_v2 VALUES
      ('ses_working', 1794860753043, NULL),
      ('ses_done', NULL, 'succeeded'),
      ('ses_failed', NULL, 'failed'),
      ('ses_cancelled', 1794860855000, 'cancelled');`);
    db.close();
    process.env.XDG_DATA_HOME = directory;
    const outcomes = openCodeIdleOutcomes([
      "ses_working",
      "ses_done",
      "ses_failed",
      "ses_cancelled",
    ]);
    // A background child is claimed by the queue right after spawning and stays claimed while it
    // works: the claim must not end the hard hold, otherwise Projector closes the connection and
    // the idle SIGTERM kills the subagent mid-step.
    expect(outcomes.has("ses_working")).toBe(false);
    expect(outcomes.get("ses_done")).toBe("done");
    expect(outcomes.get("ses_failed")).toBe("error");
    expect(outcomes.get("ses_cancelled")).toBe("stopped");
  });

  test("the schema without idle_outcome still settles on the parked claim", async () => {
    const directory = join(root, "legacy");
    const db = await idleDatabase(directory, "session", "time_suspended INTEGER");
    db.exec(
      "INSERT INTO session VALUES ('ses_old_stopped', 1794860753043), ('ses_old_live', NULL);",
    );
    db.close();
    process.env.XDG_DATA_HOME = directory;
    const outcomes = openCodeIdleOutcomes(["ses_old_stopped", "ses_old_live"]);
    expect(outcomes.get("ses_old_stopped")).toBe("stopped");
    expect(outcomes.has("ses_old_live")).toBe(false);
  });

  test("a missing database settles nothing, so the hold survives until a later notify", () => {
    process.env.XDG_DATA_HOME = join(root, "missing");
    expect(openCodeIdleOutcomes(["ses_unknown"]).size).toBe(0);
  });
});
