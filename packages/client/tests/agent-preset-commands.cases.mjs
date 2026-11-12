import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  loadStartPresets,
  registerPresetCommands,
} from "../modules/agent-presets/model/presets.ts";

afterEach(() => vi.unstubAllGlobals());

const commands = new Map();
registerPresetCommands(
  (id, _title, run, _enabled, _requires, meta) => commands.set(id, { run, meta }),
  "p1",
);

const reply = (body) => ({ ok: true, json: async () => JSON.parse(JSON.stringify(body)) });

function stubPresets() {
  const state = {
    presets: [
      {
        id: "preset-global",
        title: "Общий",
        prompt: "Посмотри проект.",
      },
    ],
    file: "/tmp/agent/presets.json",
    project: {
      projectId: "p1",
      path: "/p",
      file: "/p/.projector/presets.json",
      exists: true,
      trusted: false,
      presets: [
        {
          id: "preset-project",
          title: "Проектный",
          prompt: "Сверься с README.",
          form: '<IntelligentForm><Field name="scope" label="Что" /></IntelligentForm>',
        },
      ],
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      const href = String(url);
      const method = init?.method ?? "GET";
      if (href.startsWith("/api/agent/presets") && method === "POST") {
        const body = JSON.parse(init.body);
        const preset = { id: `preset-new-${state.presets.length}`, ...body.preset };
        if (body.projectId) {
          state.project.presets.push(preset);
          state.project.trusted = false;
        } else state.presets.push(preset);
        return reply(state);
      }
      return reply(state);
    }),
  );
  return state;
}

test("preset commands are registered with agent descriptions", () => {
  expect([...commands.keys()]).toEqual([
    "ide.agent.presets.list",
    "ide.agent.preset.create",
    "ide.agent.preset.save",
    "ide.agent.preset.delete",
  ]);
  for (const { meta } of commands.values()) expect(meta.description.length).toBeGreaterThan(30);
});

test("the list shows global presets and only trusted project presets", async () => {
  const state = stubPresets();
  const list = await commands.get("ide.agent.presets.list").run();
  expect(list.presets).toEqual([expect.objectContaining({ id: "preset-global" })]);
  expect(list.project).toMatchObject({ trusted: false });
  expect(list.project.presets[0]).toMatchObject({ id: "preset-project", opensForm: true });

  state.project.trusted = true;
  const trusted = await commands.get("ide.agent.presets.list").run();
  expect(trusted.presets.map((preset) => preset.id)).toEqual(["preset-project", "preset-global"]);
});

test("the start screen puts trusted project presets before personal ones", async () => {
  const state = stubPresets();
  const hidden = await loadStartPresets("p1");
  expect(hidden.presets.map((preset) => preset.id)).toEqual(["preset-global"]);

  state.project.trusted = true;
  const shown = await loadStartPresets("p1");
  expect(shown.projectTrusted).toBe(true);
  expect(shown.presets.map((preset) => [preset.id, preset.source])).toEqual([
    ["preset-project", "project"],
    ["preset-global", "global"],
  ]);
});

test("create defaults to a personal preset and accepts a project scope", async () => {
  const state = stubPresets();
  const global = await commands.get("ide.agent.preset.create").run({
    title: "Новый общий",
    prompt: "Помоги.",
  });
  expect(global).toMatchObject({ source: "global" });
  expect(global.preset).toMatchObject({ title: "Новый общий" });
  expect(state.presets).toHaveLength(2);

  const project = await commands.get("ide.agent.preset.create").run({
    title: "Новый проектный",
    form: '<IntelligentForm><Field name="x" label="X" /></IntelligentForm>',
    scope: "project",
  });
  expect(project).toMatchObject({ source: "project" });
  expect(project.preset).toMatchObject({ title: "Новый проектный" });
  expect(state.project.presets).toHaveLength(2);
});

test("create requires a title and something to send", async () => {
  stubPresets();
  await expect(
    commands.get("ide.agent.preset.create").run({ title: "", prompt: "x" }),
  ).rejects.toThrow(/title/);
  await expect(
    commands.get("ide.agent.preset.create").run({ title: "Пусто", prompt: " " }),
  ).rejects.toThrow(/prompt или form/);
});
