import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { createChatRole } from "../packages/server/modules/agent-roles/index.ts";
import { createAgentTools } from "../packages/server/modules/agents/projector/agent-tools.ts";
import {
  runProjectorTask,
  TASK_LIMITS,
} from "../packages/server/modules/agents/projector/index.ts";
import { scriptedModel } from "./helpers/scripted-model.mjs";

test("the task tool is offered only when a subagent runner exists", () => {
  const context = { guard: { trusting: true }, onProject: () => {} };
  expect(createAgentTools(context).task).toBeUndefined();
  expect(
    createAgentTools({
      ...context,
      runTask: async () => ({ text: "summary" }),
    }).task,
  ).toBeDefined();
});

test("Projector task reads files in its own context and reports a task", async () => {
  const directory = await mkdtemp(join(tmpdir(), "projector-task-"));
  const project = join(directory, "project");
  await mkdir(project, { recursive: true });
  await writeFile(join(project, "a.txt"), "one\n");
  const old = Object.fromEntries(
    ["XDG_DATA_HOME", "OPENAI_URL", "OPENAI_API_KEY", "OPENAI_MODEL"].map((key) => [
      key,
      process.env[key],
    ]),
  );
  process.env.XDG_DATA_HOME = join(directory, "data");
  const model = await scriptedModel([
    { tool: "read_file", args: { path: "a.txt" } },
    { text: "В a.txt лежит одна строка: one." },
  ]);
  Object.assign(process.env, {
    OPENAI_URL: model.url,
    OPENAI_API_KEY: "test",
    OPENAI_MODEL: "test",
  });
  const events = [];
  try {
    const result = await runProjectorTask({
      id: "task-1",
      description: "Проверить a.txt",
      prompt: "Что лежит в a.txt?",
      cwd: project,
      selection: { provider: "env-default:test" },
      emit: (event, data) => events.push({ event, data }),
    });
    expect(result.text).toContain("одна строка");
    expect(events.find((item) => item.event === "task").data).toMatchObject({
      id: "task-1",
      kind: "agent",
      status: "running",
      background: false,
      tool: "task",
    });
    const done = events.filter((item) => item.event === "task").at(-1).data;
    expect(done).toMatchObject({ id: "task-1", status: "done" });
    expect(done.summary).toContain("одна строка");
    expect(done.tools).toBe(1);
    expect(TASK_LIMITS.steps).toBe(6);
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await model.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("Projector task accepts a Projector chat role and rejects service or foreign roles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "projector-task-roles-"));
  const old = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
  const model = await scriptedModel([{ text: "Роль применена." }]);
  Object.assign(process.env, {
    OPENAI_URL: model.url,
    OPENAI_API_KEY: "test",
    OPENAI_MODEL: "test",
  });
  const emit = () => {};
  try {
    const created = await createChatRole({
      name: "Исследователь",
      agent: "projector",
      selection: { provider: "env-default:test" },
    });
    const role = created.created;
    const result = await runProjectorTask({
      id: "task-role",
      description: "С ролью",
      prompt: "Ответь.",
      role: role.id,
      cwd: directory,
      selection: { provider: "env-default:test" },
      emit,
    });
    expect(result.role).toBe("Исследователь");

    await expect(
      runProjectorTask({
        id: "task-doctor",
        description: "Служебная",
        prompt: "Ответь.",
        role: "doctor",
        cwd: directory,
        emit,
      }),
    ).rejects.toThrow(/Служебная/);

    const foreign = await createChatRole({
      name: "Claude",
      agent: "claude-code",
      selection: {},
    });
    await expect(
      runProjectorTask({
        id: "task-foreign",
        description: "Чужая",
        prompt: "Ответь.",
        role: foreign.created.id,
        cwd: directory,
        emit,
      }),
    ).rejects.toThrow(/Projector/);
  } finally {
    if (old === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = old;
    await model.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
