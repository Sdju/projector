import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  openCodeDatabasePath,
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
