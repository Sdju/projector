import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import {
  createPreset,
  createProjectPreset,
  deletePreset,
  deleteProjectPreset,
  presetBundle,
  presetsFile,
  projectPresetState,
  projectPresetsRelativeFile,
  projectPresetsTrustFile,
  savePreset,
  saveProjectPreset,
  setProjectPresetTrust,
  trustedProjectPresets,
} from "../modules/agent-presets/index.ts";

let directory;
let project;
let previous;

beforeEach(async () => {
  previous = process.env.XDG_DATA_HOME;
  directory = await mkdtemp(join(tmpdir(), "projector-presets-"));
  process.env.XDG_DATA_HOME = join(directory, "data");
  project = await realpath(await mkdtemp(join(directory, "project-")));
  await mkdir(join(directory, "data", "projector"), { recursive: true });
  await writeFile(
    join(directory, "data", "projector", "projects.json"),
    JSON.stringify({ projects: [{ id: "p1", name: "Project", path: project, commands: [] }] }),
  );
});

afterEach(async () => {
  if (previous === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previous;
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("global presets are created, updated and deleted", async () => {
  const created = await createPreset({
    title: "Ревью",
    description: "Проверить diff",
    prompt: "Проверь изменения и ничего не меняй.",
  });
  expect(created.file).toBe(presetsFile());
  expect(created.presets).toHaveLength(1);
  const preset = created.presets[0];
  expect(preset).toMatchObject({
    title: "Ревью",
    description: "Проверить diff",
    prompt: "Проверь изменения и ничего не меняй.",
  });
  expect(preset.id).toMatch(/^preset-[a-f0-9]{8}$/);

  const stored = JSON.parse(await readFile(presetsFile(), "utf8"));
  expect(stored.presets[0].prompt).toContain("Проверь изменения");

  const updated = await savePreset(preset.id, {
    title: "Старший ревьюер",
    prompt: "Сверяйся с AGENTS.md.",
    form: '<IntelligentForm summary="Ревью"><Field name="scope" label="Что проверить" /></IntelligentForm>',
  });
  expect(updated.presets[0]).toMatchObject({
    title: "Старший ревьюер",
    prompt: "Сверяйся с AGENTS.md.",
  });
  expect(updated.presets[0].form).toContain("<IntelligentForm");

  const removed = await deletePreset(preset.id);
  expect(removed.presets).toEqual([]);
});

test("presets need a title and something to send", async () => {
  await expect(createPreset({ title: "", prompt: "Текст" })).rejects.toThrow("Некорректный");
  await expect(createPreset({ title: "Пусто", prompt: "   " })).rejects.toThrow("Некорректный");
  await expect(createPreset({ title: "Плохая форма", prompt: "", form: "  " })).rejects.toThrow(
    "Некорректный",
  );
  await expect(savePreset("unknown", { title: "Пресет", prompt: "Текст" })).rejects.toThrow(
    "Неизвестный",
  );
});

test("a project preset created in Projector is trusted immediately", async () => {
  const created = await createProjectPreset("p1", {
    title: "Пресет проекта",
    prompt: "Сверься с README проекта.",
  });
  expect(created).toMatchObject({ projectId: "p1", exists: true, trusted: true });
  expect(created.presets).toHaveLength(1);
  expect(await trustedProjectPresets("p1")).toHaveLength(1);
  const bundle = await presetBundle("p1");
  expect(bundle.project?.presets).toHaveLength(1);
  expect(bundle.project?.trusted).toBe(true);

  const updated = await saveProjectPreset("p1", created.presets[0].id, {
    title: "Другой пресет",
    prompt: "Новый текст.",
  });
  expect(updated.trusted).toBe(true);
  expect((await projectPresetState("p1")).presets[0].title).toBe("Другой пресет");

  await deleteProjectPreset("p1", created.presets[0].id);
  expect((await projectPresetState("p1")).presets).toEqual([]);
});

test("a preset file that came with the repository stays untrusted", async () => {
  const file = join(project, projectPresetsRelativeFile);
  await mkdir(join(project, ".projector"), { recursive: true });
  await writeFile(
    file,
    JSON.stringify({
      version: 1,
      presets: [{ id: "preset-repo0001", title: "Из репозитория", prompt: "Проверь." }],
    }),
    "utf8",
  );
  expect((await projectPresetState("p1")).trusted).toBe(false);
  expect(await trustedProjectPresets("p1")).toEqual([]);

  const created = await createProjectPreset("p1", {
    title: "Пресет пользователя",
    prompt: "Сверься с README.",
  });
  expect(created.trusted).toBe(false);
  expect(created.presets).toHaveLength(2);
  expect(await trustedProjectPresets("p1")).toEqual([]);

  const trusted = await setProjectPresetTrust("p1", true);
  expect(trusted.trusted).toBe(true);
  expect(await trustedProjectPresets("p1")).toHaveLength(2);
});

test("a broken or escaping project file is reported and cannot be trusted", async () => {
  const file = join(project, projectPresetsRelativeFile);
  await mkdir(join(project, ".projector"), { recursive: true });
  await writeFile(file, "{ broken", "utf8");
  const broken = await projectPresetState("p1");
  expect(broken.trusted).toBe(false);
  expect(broken.problem).toContain("поврежд");
  await expect(setProjectPresetTrust("p1", true)).rejects.toThrow("нельзя доверять");

  await writeFile(file, JSON.stringify({ version: 1, presets: [] }), "utf8");
  const outside = join(directory, "outside-presets.json");
  await writeFile(outside, JSON.stringify({ version: 1, presets: [] }), "utf8");
  await rm(file);
  await symlink(outside, file);
  const escaped = await projectPresetState("p1");
  expect(escaped.trusted).toBe(false);
  expect(escaped.problem).toContain("за его пределы");
});

test("trust is bound to the file hash and the trust file is private", async () => {
  await createProjectPreset("p1", { title: "Пресет", prompt: "Текст." });
  await setProjectPresetTrust("p1", true);
  const file = join(project, projectPresetsRelativeFile);
  expect(await readFile(file, "utf8")).toContain("Пресет");

  await writeFile(file, JSON.stringify({ version: 1, presets: [] }), "utf8");
  expect((await projectPresetState("p1")).trusted).toBe(false);
  const trust = JSON.parse(await readFile(projectPresetsTrustFile(), "utf8"));
  expect(trust.projects[await realpath(project)]).toMatchObject({ hash: expect.any(String) });
});
