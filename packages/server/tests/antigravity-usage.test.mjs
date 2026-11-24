import { expect, test } from "vite-plus/test";
import { mkdirSync, rmSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { registerAgentFeature } from "../modules/agent-features/index.ts";
import { acpTurnPrompt, openSession } from "../modules/agents/acp/acp-backend.ts";
import { availableCommands } from "../modules/agents/acp/acp-events.ts";
import { decidePermission } from "../modules/agents/acp/acp-permission.ts";
import {
  antigravityBackend,
  antigravityProgram,
  antigravityRateModel,
  antigravityShellCommand,
  antigravitySkillState,
  cachedAntigravityUsage,
  classifyAntigravityTurnFailure,
  createAntigravityDialect,
  handleAntigravityPermission,
  installAntigravitySkill,
  parseAntigravityCliUsage,
  parseAntigravityResetTime,
  readAntigravityUsageFile,
  refreshAntigravityUsage,
  removeAntigravitySkill,
  resetAntigravityUsageCache,
  watchAntigravityPromptOutcome,
} from "../modules/agents/antigravity/index.ts";
import { createRouteDispatcher } from "../modules/transport/index.ts";
import { routes as antigravityRoutes } from "../routes/api/antigravity.ts";

function protoNumber(field, value) {
  const varint = (number) => {
    const bytes = [];
    do {
      const byte = number % 128;
      number = Math.floor(number / 128);
      bytes.push(byte + (number > 0 ? 128 : 0));
    } while (number > 0);
    return bytes;
  };
  return [...varint(field * 8), ...varint(value)];
}

function protoBytes(field, bytes) {
  const encoded = protoNumber(field, bytes.length);
  encoded[0] += 2;
  return [...encoded, ...bytes];
}

function protoText(field, value) {
  return protoBytes(field, [...Buffer.from(value)]);
}

test("Antigravity backend uses official agy ACP in strict thin-client mode with CLI login hint", () => {
  expect(antigravityProgram).toMatchObject({
    id: "antigravity",
    label: "Antigravity",
    command: "agy",
    args: ["acp"],
    terminal: { program: "agy", executable: "agy", title: "Antigravity" },
    scrubEnv: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    withheldCommands: ["logout"],
    nativePromptOnly: true,
  });
  expect(antigravityProgram.authHint).toContain("agy acp --login");
  expect(antigravityBackend.id).toBe("antigravity");
  expect(antigravityBackend.usageLog?.agent).toBe("antigravity");
  expect(
    availableCommands([{ name: "plan" }, { name: "logout" }], antigravityProgram.withheldCommands),
  ).toStrictEqual([{ name: "plan" }]);
  expect(
    acpTurnPrompt(
      "Fix the bug",
      [{ role: "user", content: "Old chat" }],
      "[Projector] Extra instructions",
      false,
      antigravityProgram.nativePromptOnly,
    ),
  ).toBe("Fix the bug");
});

test("ACP openSession prefers session/resume without injecting _meta and surfaces authHint without hanging", async () => {
  const resumeCalls = [];
  const resumable = {
    async request(method, params) {
      resumeCalls.push({ method, params });
      return { configOptions: [] };
    },
  };
  const resumed = await openSession(
    resumable,
    { sessionId: "conv-1", cwd: "/tmp" },
    [],
    () => {},
    true,
    {},
    [],
    undefined,
    antigravityProgram.authHint,
    true,
  );
  expect(resumed).toMatchObject({ sessionId: "conv-1", resumed: true });
  expect(resumeCalls).toHaveLength(1);
  expect(resumeCalls[0].method).toBe("session/resume");
  expect(resumeCalls[0].params._meta).toBeUndefined();

  const authCalls = [];
  const unauthenticated = {
    async request(method) {
      authCalls.push(method);
      if (method === "session/new") throw new Error("Authentication required");
      throw new Error(`Unexpected method: ${method}`);
    },
  };
  await expect(
    openSession(
      unauthenticated,
      { cwd: "/tmp" },
      [{ id: "oauth-personal" }],
      () => {},
      true,
      {},
      [],
      undefined,
      antigravityProgram.authHint,
    ),
  ).rejects.toMatchObject({
    code: 401,
    message: antigravityProgram.authHint,
  });
  expect(authCalls).toStrictEqual(["session/new"]);
});

test("Antigravity permission handler routes interaction_* questions to ask and surfaces security warnings", async () => {
  const asked = [];
  const questionResponse = await handleAntigravityPermission(
    {
      message: "",
      emit() {},
      async ask(request) {
        asked.push(request);
        return { interaction_1: ["opt-2"] };
      },
    },
    {
      toolCall: { toolCallId: "interaction_1", title: "Choose environment" },
      options: [
        { optionId: "opt-1", name: "Staging" },
        { optionId: "opt-2", name: "Production" },
      ],
    },
  );
  expect(questionResponse).toStrictEqual({ outcome: { outcome: "selected", optionId: "opt-2" } });
  expect(asked[0].questions[0]).toMatchObject({
    id: "interaction_1",
    question: "Choose environment",
    multiple: false,
    custom: false,
  });

  // Ordinary tool permission passes through to decidePermission with CommandLine and warning metadata.
  expect(
    handleAntigravityPermission(
      { message: "", emit() {} },
      { toolCall: { toolCallId: "call_1" }, options: [] },
    ),
  ).toBeUndefined();

  const approved = [];
  const perm = await decidePermission(
    {
      message: "",
      emit() {},
      async approve(request) {
        approved.push(request);
        return true;
      },
    },
    {
      toolCall: { kind: "execute", rawInput: { CommandLine: "git status" } },
      options: [
        { optionId: "once", kind: "allow_once" },
        {
          optionId: "always",
          kind: "allow_always",
          _meta: { "agy.security.warning": { message: "Allows all shell commands" } },
        },
      ],
    },
    antigravityShellCommand,
  );
  expect(perm).toStrictEqual({ outcome: { outcome: "selected", optionId: "once" } });
  expect(approved[0].detail).toContain("$ git status");
  expect(approved[0].detail).toContain("Allows all shell commands");
});

test("Antigravity dialect normalizes shell output and tracks subagent batches", () => {
  const dialect = createAntigravityDialect();
  expect(dialect.tool({ kind: "execute", title: "ls -la" })).toStrictEqual({ name: "bash" });
  expect(
    dialect.result({ rawOutput: { combinedOutput: "ok\n", exitCode: 0 } }, "t1", '{"raw":true}'),
  ).toBe("ok\n");
  expect(dialect.result({ rawOutput: { combinedOutput: "", exitCode: 2 } }, "t2", "")).toBe(
    "Код выхода 2",
  );

  // MCP calls with the same title must not be tracked as subagents.
  expect(
    dialect.call(
      {
        kind: "other",
        title: "Running invoke_subagent",
        _meta: { is_mcp_tool_call: true },
      },
      "mcp-1",
    ),
  ).toStrictEqual([]);

  const started = dialect.call(
    {
      kind: "other",
      title: "Running invoke_subagent",
      rawInput: { Subagents: [{ Role: "Researcher", Prompt: "Check logs" }] },
    },
    "sub-1",
  );
  expect(started).toMatchObject([
    { id: "sub-1", kind: "agent", title: "Researcher", prompt: "Check logs", status: "running" },
  ]);
  expect(dialect.finish()).toStrictEqual([{ id: "sub-1", status: "done" }]);
});

test("Antigravity turn outcome detects silent SQLite error steps and refusal quota exhaustion", async () => {
  const directory = join(tmpdir(), `agy-outcome-${Date.now()}`);
  const file = join(directory, "sess-1.db");
  mkdirSync(directory, { recursive: true });
  try {
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE steps (idx INTEGER, step_type INTEGER, step_payload BLOB)");
    db.prepare("INSERT INTO steps VALUES (?, ?, ?)").run(0, 1, Buffer.from("ok"));
    db.close();

    const check = await watchAntigravityPromptOutcome("sess-1", directory);
    const dbAfter = new DatabaseSync(file);
    dbAfter
      .prepare("INSERT INTO steps VALUES (?, ?, ?)")
      .run(
        1,
        17,
        Buffer.from(
          "Error 429, Message: Quota exceeded, Status: RESOURCE_EXHAUSTED [reason:QUOTA_EXHAUSTED quotaResetTimeStamp:2030-01-01T12:00:00Z]",
        ),
      );
    dbAfter.close();

    const failure = await check("end_turn");
    expect(failure).toMatchObject({
      class: "usage_limit",
      code: "RESOURCE_EXHAUSTED",
      retryable: true,
      resetAt: Date.parse("2030-01-01T12:00:00Z"),
    });
    expect(classifyAntigravityTurnFailure("refusal", undefined)).toMatchObject({
      class: "usage_limit",
      code: "QUOTA_EXHAUSTED",
      retryable: true,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Antigravity usage log reads step protobuf tokens, trajectory fallback timestamp, and rate models", () => {
  const directory = join(tmpdir(), `agy-usage-${Date.now()}`);
  const file = join(directory, "conv-1.db");
  mkdirSync(directory, { recursive: true });
  try {
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE steps (idx INTEGER, metadata BLOB)");
    db.exec("CREATE TABLE trajectory_metadata_blob (data BLOB)");
    const trajectory = new Uint8Array(protoBytes(2, protoNumber(1, 1_710_000_000)));
    db.prepare("INSERT INTO trajectory_metadata_blob VALUES (?)").run(trajectory);
    const usage = protoBytes(9, [
      ...protoNumber(1, 1319),
      ...protoNumber(2, 100),
      ...protoNumber(3, 20),
      ...protoNumber(5, 10),
      ...protoText(11, "req-1"),
    ]);
    const model = [...protoNumber(1, 1319), ...protoText(12, "Gemini 3.8 Flash (Medium)")];
    const step = new Uint8Array([...protoBytes(24, model), ...usage]);
    db.prepare("INSERT INTO steps VALUES (?, ?)").run(0, step);
    db.close();
    const events = readAntigravityUsageFile(file, 1_700_000_000_000);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      session: "conv-1",
      model: "gemini-3.8-flash-medium",
      tokens: { input: 100, output: 20, cacheRead: 10, cacheWrite: 0 },
      costSource: "none",
    });
    expect(events[0].at).toBe(1_710_000_000_000);
    expect(antigravityRateModel("gemini-3.8-flash-medium")).toBe("gemini-3.8-flash");
    expect(antigravityRateModel("gemini-3-flash-agent-a")).toBe("gemini-3.5-flash");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Antigravity Projector skill installs, detects drift, removes cleanly, and serves HTTP API", async () => {
  registerAgentFeature({
    id: "widgets",
    title: "Виджеты",
    summary: "Виджеты",
    instruction: () => "Тестовая справка по виджетам Projector.",
  });
  registerAgentFeature({
    id: "ide",
    title: "Команды IDE",
    summary: "IDE",
    instruction: () => "Тестовая справка по MCP projector-ide.",
  });

  const directory = await mkdtemp(join(tmpdir(), "projector-agy-skill-"));
  const previousHome = process.env.HOME;
  const previousProfile = process.env.USERPROFILE;
  process.env.HOME = directory;
  process.env.USERPROFILE = directory;
  const file = join(directory, ".gemini", "config", "skills", "projector", "SKILL.md");
  const dispatch = createRouteDispatcher(antigravityRoutes);
  const callRoute = async (method) => {
    const chunks = [];
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value;
      },
      writeHead(code) {
        this.statusCode = code;
      },
      end(body) {
        chunks.push(body);
      },
    };
    const matched = await dispatch({ res, method, path: "/api/antigravity/skill" });
    expect(matched).toBe(true);
    return { status: res.statusCode, body: JSON.parse(chunks.join("")) };
  };

  try {
    const initial = await callRoute("GET");
    expect(initial.status).toBe(200);
    expect(initial.body).toMatchObject({ status: "missing", name: "projector", file });
    expect(initial.body.content).toContain("name: projector");
    expect(initial.body.content).toContain("Тестовая справка по виджетам Projector.");
    expect(initial.body.content).toContain("Тестовая справка по MCP projector-ide.");
    expect(initial.body.content).toContain("ide.agent.roles.chat.list");

    const installed = await callRoute("PUT");
    expect(installed.body.status).toBe("installed");
    expect(await readFile(file, "utf8")).toBe(installed.body.content);

    await writeFile(file, "---\nname: projector\n---\nstale\n", "utf8");
    expect((await antigravitySkillState(file)).status).toBe("outdated");

    expect((await installAntigravitySkill(file)).status).toBe("installed");
    expect((await callRoute("DELETE")).body.status).toBe("missing");
    expect((await removeAntigravitySkill(file)).status).toBe("missing");
  } finally {
    process.env.HOME = previousHome;
    process.env.USERPROFILE = previousProfile;
    await rm(directory, { recursive: true, force: true });
  }
});

test('Antigravity CLI /usage parser handles real agy -p "/usage" --output-format json and manual cache stays idle until refreshed', async () => {
  resetAntigravityUsageCache();
  try {
    expect(cachedAntigravityUsage()).toMatchObject({ status: "idle", windows: null, checkedAt: 0 });

    const jsonSample = JSON.stringify({
      conversation_id: "",
      status: "SUCCESS",
      response:
        "Gemini Models\tWeekly Limit Remaining\t88%\t2026-12-01T14:44:02Z\nGemini Models\tFive Hour Limit Remaining\t53%\t2026-11-24T19:44:02Z\n",
      command: {
        name: "usage",
        data: {
          groups: [
            {
              name: "Gemini Models",
              buckets: [
                {
                  id: "gemini-weekly",
                  window: "weekly",
                  remaining_fraction: 0.88435,
                  reset_time: "2026-12-01T14:44:02Z",
                },
                {
                  id: "gemini-5h",
                  window: "5h",
                  remaining_fraction: 0.53164,
                  reset_time: "2026-11-24T19:44:02Z",
                },
              ],
            },
            {
              name: "Claude and GPT models",
              buckets: [
                {
                  id: "3p-weekly",
                  window: "weekly",
                  remaining_fraction: 1,
                  reset_time: "1970-01-01T00:00:00Z",
                },
                {
                  id: "3p-5h",
                  window: "5h",
                  remaining_fraction: 0,
                  reset_time: "1970-01-01T00:00:00Z",
                },
              ],
            },
          ],
        },
      },
    });

    expect(parseAntigravityResetTime("1970-01-01T00:00:00Z")).toBeNull();
    expect(parseAntigravityResetTime("1970-01-01 05:00 +05")).toBeNull();
    expect(parseAntigravityResetTime("2026-12-01T14:44:02Z")).toBe(
      Date.parse("2026-12-01T14:44:02Z") / 1000,
    );

    const parsed = parseAntigravityCliUsage(jsonSample);
    expect(parsed).toMatchObject({
      geminiWeekly: {
        usedPercent: 11.57,
        resetsAt: Date.parse("2026-12-01T14:44:02Z") / 1000,
        limited: false,
      },
      geminiRolling: {
        usedPercent: 46.84,
        resetsAt: Date.parse("2026-11-24T19:44:02Z") / 1000,
        limited: false,
      },
      thirdPartyWeekly: { usedPercent: 0, resetsAt: null, limited: false },
      thirdPartyRolling: { usedPercent: 100, resetsAt: null, limited: true },
    });

    // Plain-text fallback still works if command.data is omitted.
    expect(
      parseAntigravityCliUsage(
        "Gemini Models   Weekly Limit Remaining  91%  2026-12-01 19:44 +05\n",
      )?.geminiWeekly,
    ).toMatchObject({
      usedPercent: 9,
      resetsAt: Date.parse("2026-12-01T19:44:00+05:00") / 1000,
      limited: false,
    });

    const refreshed = await refreshAntigravityUsage(async () => jsonSample);
    expect(refreshed.status).toBe("ready");
    expect(refreshed.windows?.geminiRolling?.usedPercent).toBe(46.84);

    // GET /api/antigravity/usage returns only the cached snapshot without spawning agy.
    const dispatch = createRouteDispatcher(antigravityRoutes);
    const chunks = [];
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value;
      },
      writeHead(code) {
        this.statusCode = code;
      },
      end(body) {
        chunks.push(body);
      },
    };
    expect(await dispatch({ res, method: "GET", path: "/api/antigravity/usage" })).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(chunks.join(""))).toMatchObject({
      status: "ready",
      windows: { geminiWeekly: { usedPercent: 11.57 } },
    });
  } finally {
    resetAntigravityUsageCache();
  }
});
