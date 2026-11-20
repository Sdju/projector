import { afterAll, beforeAll, describe, expect, test, vi } from "vite-plus/test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  openCodeDatabasePath,
  openCodeIdleOutcomes,
  openCodeSessionMeta,
  openCodeStepState,
  prepareOpenCodeFollowUp,
  watchOpenCodeFollowUp,
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

describe("OpenCode follow-up step after a background report", () => {
  let previous, root;
  beforeAll(async () => {
    previous = process.env.XDG_DATA_HOME;
    root = await mkdtemp(join(tmpdir(), "projector-opencode-follow-up-"));
  });
  afterAll(async () => {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(root, { recursive: true, force: true });
  });

  /** Creates the transcript table OpenCode writes its messages and step markers into. */
  async function transcript(directory, rows) {
    await mkdir(join(directory, "opencode"), { recursive: true });
    const db = new DatabaseSync(join(directory, "opencode", "opencode.db"));
    db.exec(
      `CREATE TABLE session_message (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL,
        time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
      );`,
    );
    const insert = db.prepare(
      "INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const row of rows)
      insert.run(row.id, row.session ?? "ses_main", row.type, row.seq, 0, 0, row.data ?? "{}");
    db.close();
  }

  test("ownership is read once per message, including interleaved child streams", () => {
    const read = vi.fn(() => ({
      last: "assistant",
      seq: 5,
      idle: 3,
      user: 4,
      firstUser: 4,
      interrupted: false,
    }));
    const observer = prepareOpenCodeFollowUp("ses_main", read);
    const chunk = { sessionUpdate: "agent_message_chunk", messageId: "msg_a" };
    for (let i = 0; i < 100; i++) {
      expect(observer.acceptsUpdates("ses_main", chunk)).toBe(true);
      expect(observer.acceptsUpdates("ses_child", chunk)).toBe(true);
      expect(
        observer.acceptsUpdates("ses_main", {
          ...chunk,
          _meta: { "opencode/child-session": { id: "inline_child" } },
        }),
      ).toBe(true);
    }
    expect(read).toHaveBeenCalledTimes(4); // baseline and one read per source
    expect(
      observer.acceptsUpdates("ses_main", { ...chunk, sessionUpdate: "agent_thought_chunk" }),
    ).toBe(true);
    expect(read).toHaveBeenCalledTimes(4);
  });

  test("a new message immediately after a check cannot inherit the old ownership", () => {
    let state = { last: "assistant", seq: 5, idle: 3, user: 4, firstUser: 4, interrupted: false };
    const read = vi.fn(() => state);
    const observer = prepareOpenCodeFollowUp("ses_main", read);
    const chunk = { sessionUpdate: "agent_message_chunk", messageId: "own" };
    expect(observer.acceptsUpdates("ses_main", chunk)).toBe(true);
    state = { ...state, seq: 7, user: 6 };
    expect(observer.acceptsUpdates("ses_main", { ...chunk, messageId: "foreign" })).toBe(false);
    expect(observer.acceptsUpdates("ses_main", chunk)).toBe(false);
    expect(read).toHaveBeenCalledTimes(3);
  });

  test("structural and unidentified updates recheck ownership and invalidate message entries", () => {
    const read = vi.fn(() => ({
      last: "assistant",
      seq: 5,
      idle: 3,
      user: 4,
      firstUser: 4,
      interrupted: false,
    }));
    const observer = prepareOpenCodeFollowUp("ses_main", read);
    const chunk = { sessionUpdate: "agent_message_chunk", messageId: "own" };
    observer.acceptsUpdates("ses_main", chunk);
    observer.acceptsUpdates("ses_main", { sessionUpdate: "tool_call", messageId: "own" });
    observer.acceptsUpdates("ses_main", chunk);
    observer.acceptsUpdates("ses_main", { sessionUpdate: "agent_message_chunk" });
    observer.acceptsUpdates("ses_main", { sessionUpdate: "agent_message_chunk" });
    observer.acceptsUpdates("ses_main", chunk);
    expect(read).toHaveBeenCalledTimes(7);
  });

  test.each([
    { sessionUpdate: "tool_call", messageId: "own" },
    { sessionUpdate: "agent_message_chunk" },
    { sessionUpdate: "session_info_update" },
  ])("a structural or unidentified update cannot reuse ownership: %j", (update) => {
    let state = { last: "assistant", seq: 5, idle: 3, user: 4, firstUser: 4, interrupted: false };
    const observer = prepareOpenCodeFollowUp("ses_main", () => state);
    expect(
      observer.acceptsUpdates("ses_main", {
        sessionUpdate: "agent_message_chunk",
        messageId: "own",
      }),
    ).toBe(true);
    state = { ...state, seq: 7, user: 6 };
    expect(observer.acceptsUpdates("ses_main", update)).toBe(false);
  });

  test("watcher ownership loss invalidates an already accepted message", async () => {
    let state = { last: "assistant", seq: 5, idle: 3, user: 4, firstUser: 4, interrupted: false };
    const observer = prepareOpenCodeFollowUp("ses_main", () => state);
    const chunk = { sessionUpdate: "agent_message_chunk", messageId: "own" };
    expect(observer.acceptsUpdates("ses_main", chunk)).toBe(true);
    state = { ...state, seq: 7, user: 6 };
    await expect(observer.wait({ pending: () => 0 })).resolves.toEqual({ status: "superseded" });
    expect(observer.acceptsUpdates("ses_main", chunk)).toBe(false);
  });

  test("ownership sees a human message even after an assistant hides it", async () => {
    const directory = join(root, "ownership");
    await transcript(directory, [{ id: "old", type: "idle", seq: 3 }]);
    process.env.XDG_DATA_HOME = directory;
    const observer = prepareOpenCodeFollowUp("ses_main");
    const db = new DatabaseSync(openCodeDatabasePath());
    try {
      const insert = db.prepare(
        "INSERT INTO session_message VALUES (?, 'ses_main', ?, ?, 0, 0, '{}')",
      );
      insert.run("own-user", "user", 4);
      insert.run("own-answer", "assistant", 5);
      expect(observer.acceptsUpdates("ses_main", {})).toBe(true);
      insert.run("foreign-user", "user", 6);
      insert.run("foreign-answer", "assistant", 7);
      expect(openCodeStepState("ses_main", 3)).toMatchObject({
        last: "assistant",
        user: 6,
        firstUser: 4,
      });
      expect(observer.acceptsUpdates("ses_main", {})).toBe(false);
      await expect(observer.wait({ pending: () => 0 })).resolves.toEqual({ status: "superseded" });
    } finally {
      db.close();
    }
  });

  test("a rejected chunk remains an observation error after the database recovers", async () => {
    const directory = join(root, "lost-chunk");
    await transcript(directory, [{ id: "i", type: "idle", seq: 3 }]);
    process.env.XDG_DATA_HOME = directory;
    const observer = prepareOpenCodeFollowUp("ses_main");
    process.env.XDG_DATA_HOME = join(root, "temporarily-unavailable");
    expect(observer.acceptsUpdates("ses_main", {})).toBe(false);
    process.env.XDG_DATA_HOME = directory;
    expect(observer.acceptsUpdates("ses_main", {})).toBe(false);
    vi.useFakeTimers();
    try {
      const result = observer.wait({ pending: () => 0 });
      await vi.advanceTimersByTimeAsync(3000);
      await expect(result).resolves.toMatchObject({ status: "unavailable" });
    } finally {
      vi.useRealTimers();
    }
  });

  test("a missing schema is explicitly unavailable", async () => {
    process.env.XDG_DATA_HOME = join(root, "unknown-schema");
    const observer = prepareOpenCodeFollowUp("ses_main");
    expect(observer.acceptsUpdates("ses_main", {})).toBe(false);
    await expect(observer.wait({ pending: () => 0 })).resolves.toMatchObject({
      status: "unavailable",
    });
  });

  test("a continuation completed before the first poll is still completed", async () => {
    vi.useFakeTimers();
    try {
      const idle = { last: "idle", seq: 9, idle: 9, user: 4, firstUser: 4, interrupted: false };
      const watch = watchOpenCodeFollowUp("ses_main", {
        read: () => idle,
        intervalMs: 10,
        startMs: 30,
        quietMs: 20,
        totalMs: 100,
      });
      await vi.advanceTimersByTimeAsync(50);
      await expect(watch).resolves.toEqual({ status: "completed" });
    } finally {
      vi.useRealTimers();
    }
  });

  test("a child reaching the observation limit is not completed", async () => {
    vi.useFakeTimers();
    try {
      const idle = { last: "idle", seq: 3, idle: 3, user: 1, firstUser: 1, interrupted: false };
      const watch = watchOpenCodeFollowUp("ses_main", {
        read: () => idle,
        pending: () => 1,
        intervalMs: 10,
        startMs: 30,
        quietMs: 20,
        totalMs: 100,
      });
      await vi.advanceTimersByTimeAsync(110);
      await expect(watch).resolves.toMatchObject({ status: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  test("an observed child finishing at the deadline still gets its report window", async () => {
    vi.useFakeTimers();
    try {
      const idle = { last: "idle", seq: 3, idle: 3, user: 1, firstUser: 1, interrupted: false };
      let pending = 1;
      const finished = vi.fn();
      const watch = watchOpenCodeFollowUp("ses_main", {
        read: () => idle,
        pending: () => pending,
        intervalMs: 10,
        startMs: 30,
        quietMs: 20,
        totalMs: 100,
      }).then(finished);
      await vi.advanceTimersByTimeAsync(99);
      pending = 0;
      await vi.advanceTimersByTimeAsync(30);
      expect(finished).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await watch;
      expect(finished).toHaveBeenCalledWith({ status: "completed" });
    } finally {
      vi.useRealTimers();
    }
  });

  test("silent autonomous work settles without a new idle row after the prompt", async () => {
    const directory = join(root, "no-new-idle");
    await transcript(directory, [{ id: "old-idle", type: "idle", seq: 3 }]);
    process.env.XDG_DATA_HOME = directory;
    const observer = prepareOpenCodeFollowUp("ses_main");
    const db = new DatabaseSync(openCodeDatabasePath());
    try {
      db.exec(`INSERT INTO session_message VALUES
        ('prompt', 'ses_main', 'user', 4, 0, 0, '{}'),
        ('first-answer', 'ses_main', 'assistant', 5, 0, 0, '{}'),
        ('report', 'ses_main', 'synthetic', 6, 0, 0, '{}'),
        ('continuation', 'ses_main', 'assistant', 7, 0, 0, '{}')`);
      expect(openCodeStepState("ses_main", 3)).toMatchObject({
        last: "assistant",
        seq: 7,
        idle: 3,
      });
      vi.useFakeTimers();
      let pending = 1;
      const result = observer.wait({ pending: () => pending });
      pending = 0;
      await vi.advanceTimersByTimeAsync(6000);
      await expect(result).resolves.toEqual({ status: "completed" });
    } finally {
      vi.useRealTimers();
      db.close();
    }
  });

  test("lost reads never satisfy the quiet window", async () => {
    vi.useFakeTimers();
    try {
      const idle = { last: "idle", seq: 3, idle: 3, user: 1, firstUser: 1, interrupted: false };
      let reads = 0;
      const watch = watchOpenCodeFollowUp("ses_main", {
        read: () => (reads++ === 0 ? idle : undefined),
        intervalMs: 10,
        startMs: 30,
        quietMs: 20,
        totalMs: 100,
      });
      await vi.advanceTimersByTimeAsync(50);
      await expect(watch).resolves.toMatchObject({ status: "unavailable" });
    } finally {
      vi.useRealTimers();
    }
  });

  test("an idle marker closes the step, an aborted assistant message closes it without one", async () => {
    const directory = join(root, "state");
    await transcript(directory, [
      { id: "m1", type: "user", seq: 1 },
      { id: "m2", type: "assistant", seq: 2 },
      { id: "m3", type: "idle", seq: 3 },
    ]);
    process.env.XDG_DATA_HOME = directory;
    expect(openCodeStepState("ses_main")).toStrictEqual({
      last: "idle",
      seq: 3,
      idle: 3,
      interrupted: false,
      user: 1,
      firstUser: 1,
    });

    await transcript(join(root, "state-2"), [
      { id: "m1", type: "user", seq: 1 },
      { id: "m2", type: "assistant", seq: 2 },
      { id: "m3", type: "idle", seq: 3 },
      { id: "m4", type: "synthetic", seq: 4 },
      {
        id: "m5",
        type: "assistant",
        seq: 5,
        data: JSON.stringify({ finish: "error", error: { type: "aborted" } }),
      },
    ]);
    process.env.XDG_DATA_HOME = join(root, "state-2");
    // The database is reopened for every read, so the new rows are seen without a restart.
    expect(openCodeStepState("ses_main")).toStrictEqual({
      last: "assistant",
      seq: 5,
      idle: 3,
      interrupted: true,
      user: 1,
      firstUser: 1,
    });
  });

  test("an idle row cannot hide the latest assistant error", async () => {
    const directory = join(root, "idle-after-error");
    await transcript(directory, [
      { id: "u", type: "user", seq: 1 },
      {
        id: "a",
        type: "assistant",
        seq: 2,
        data: JSON.stringify({ finish: "error", error: { type: "aborted" } }),
      },
      { id: "i", type: "idle", seq: 3 },
    ]);
    process.env.XDG_DATA_HOME = directory;
    expect(openCodeStepState("ses_main")).toMatchObject({ last: "idle", interrupted: true });
    expect(openCodeStepState("ses_main", 3)).toMatchObject({ interrupted: false });
  });

  test("a missing transcript leaves the run to close as before", () => {
    process.env.XDG_DATA_HOME = join(root, "missing");
    expect(openCodeStepState("ses_main")).toBeUndefined();
  });

  test("the wake-up step sends one start notice during the report window", async () => {
    vi.useFakeTimers();
    try {
      const steps = [
        { last: "idle", seq: 3, idle: 3, interrupted: false },
        { last: "synthetic", seq: 4, idle: 3, interrupted: false },
        { last: "assistant", seq: 5, idle: 3, interrupted: false },
        { last: "idle", seq: 6, idle: 6, interrupted: false },
      ];
      let index = 0;
      const starts = [];
      const watch = watchOpenCodeFollowUp("ses_main", {
        read: () => steps[Math.min(index++, steps.length - 1)],
        intervalMs: 10,
        startMs: 100,
        quietMs: 30,
        totalMs: 1000,
        onStart: () => starts.push("step"),
      });
      await vi.advanceTimersByTimeAsync(200);
      await expect(watch).resolves.toEqual({ status: "completed" });
      // One step, one notice: the child report does not turn into several starting events.
      expect(starts).toStrictEqual(["step"]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("the initial idle also settles when no autonomous step is needed", async () => {
    vi.useFakeTimers();
    try {
      const idle = { last: "idle", seq: 3, idle: 3, interrupted: false };
      const watch = watchOpenCodeFollowUp("ses_main", {
        read: () => idle,
        intervalMs: 10,
        startMs: 100,
        quietMs: 30,
        totalMs: 1000,
      });
      await vi.advanceTimersByTimeAsync(200);
      await expect(watch).resolves.toEqual({ status: "completed" });
    } finally {
      vi.useRealTimers();
    }
  });

  test("a human message during the watch belongs to the next turn, not to this answer", async () => {
    vi.useFakeTimers();
    try {
      const steps = [
        { last: "idle", seq: 3, idle: 3, interrupted: false },
        { last: "user", seq: 4, idle: 3, interrupted: false, user: 4, firstUser: 1 },
      ];
      let index = 0;
      const watch = watchOpenCodeFollowUp("ses_main", {
        read: () => steps[Math.min(index++, steps.length - 1)],
        intervalMs: 10,
        startMs: 100,
        quietMs: 30,
        totalMs: 1000,
      });
      await vi.advanceTimersByTimeAsync(200);
      await expect(watch).resolves.toEqual({ status: "superseded" });
    } finally {
      vi.useRealTimers();
    }
  });

  test("a message already waiting is not read as a wake-up step", async () => {
    vi.useFakeTimers();
    try {
      const watch = watchOpenCodeFollowUp("ses_main", {
        read: () => ({ last: "user", seq: 4, idle: 3, interrupted: false, user: 4, firstUser: 1 }),
        intervalMs: 10,
        startMs: 100,
        quietMs: 30,
        totalMs: 1000,
      });
      await vi.advanceTimersByTimeAsync(200);
      await expect(watch).resolves.toEqual({ status: "superseded" });
    } finally {
      vi.useRealTimers();
    }
  });

  test("an aborted wake-up step is an error, not successful completion", async () => {
    vi.useFakeTimers();
    try {
      const steps = [
        { last: "idle", seq: 3, idle: 3, interrupted: false },
        { last: "assistant", seq: 4, idle: 3, interrupted: true },
      ];
      let index = 0;
      const watch = watchOpenCodeFollowUp("ses_main", {
        read: () => steps[Math.min(index++, steps.length - 1)],
        intervalMs: 10,
        startMs: 100,
        quietMs: 30,
        totalMs: 1000,
      });
      await vi.advanceTimersByTimeAsync(200);
      await expect(watch).resolves.toMatchObject({ status: "failed" });
    } finally {
      vi.useRealTimers();
    }
  });
});
