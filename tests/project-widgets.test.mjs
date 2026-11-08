import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import {
  projectWidgetData,
  projectWidgetState,
  projectWidgetsRelativeFile,
  setProjectWidgetTrust,
  trustedProjectWidgets,
} from "../packages/server/modules/project-widgets/index.ts";
import {
  createWidgetCatalog,
  normalizeProjectWidget,
  PROJECT_WIDGET_LIMITS,
  renderWidgetGuide,
} from "../packages/core/modules/widget-catalog/index.ts";

let directory;
let project;
let previous;

const widgetFile = () => join(project, projectWidgetsRelativeFile);

const writeWidgets = (widgets) =>
  writeFile(widgetFile(), JSON.stringify({ version: 1, widgets }, null, 2), "utf8");

const metrics = {
  name: "ModelMetrics",
  summary: "метрики модели",
  special: true,
  props: { model: { type: "string", description: "имя модели", required: true } },
  data: { metrics: "metrics.json" },
  template:
    '<Card :title="model"><Stat label="Скорость" :value="data.metrics?.speed ?? 0" /></Card>',
  styles: ".card { border: 0 }",
  example: '<ModelMetrics model="gpt-5" />',
};

beforeEach(async () => {
  previous = process.env.XDG_DATA_HOME;
  directory = await mkdtemp(join(tmpdir(), "projector-project-widgets-"));
  process.env.XDG_DATA_HOME = join(directory, "data");
  project = await realpath(await mkdtemp(join(directory, "project-")));
  await mkdir(join(directory, "data", "projector"), { recursive: true });
  await writeFile(
    join(directory, "data", "projector", "projects.json"),
    JSON.stringify({ projects: [{ id: "p1", name: "Project", path: project, commands: [] }] }),
  );
  await mkdir(join(project, ".projector"), { recursive: true });
});

afterEach(async () => {
  if (previous === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previous;
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("project widgets are inert until the file is trusted", async () => {
  await writeWidgets([metrics]);
  const state = await projectWidgetState("p1");
  expect(state).toMatchObject({ projectId: "p1", exists: true, trusted: false });
  expect(state.widgets).toHaveLength(1);
  expect(state.widgets[0]).toMatchObject({
    name: "ModelMetrics",
    group: "project",
    special: true,
    data: { metrics: "metrics.json" },
  });
  expect(await trustedProjectWidgets("p1")).toEqual([]);

  const trusted = await setProjectWidgetTrust("p1", true);
  expect(trusted.trusted).toBe(true);
  expect(await trustedProjectWidgets("p1")).toHaveLength(1);

  await writeWidgets([{ ...metrics, summary: "другие метрики" }]);
  expect((await projectWidgetState("p1")).trusted).toBe(false);
  expect(await trustedProjectWidgets("p1")).toEqual([]);
});

test("only valid project widgets may use built-ins and trusted data files", async () => {
  expect(
    normalizeProjectWidget({
      name: "Card",
      summary: "тень встроенного",
      template: "<div />",
    }),
  ).toBeUndefined();
  expect(
    normalizeProjectWidget({
      name: "Broken",
      summary: "неизвестный компонент",
      template: "<Nope />",
    }),
  ).toBeUndefined();
  expect(
    normalizeProjectWidget({
      name: "Scripted",
      summary: "скрипт",
      template: "<script>alert(1)</script><div />",
    }),
  ).toBeUndefined();
  expect(
    normalizeProjectWidget(
      {
        name: "Sibling",
        summary: "ссылается на соседа",
        template: "<SiblingWidget />",
      },
      ["SiblingWidget"],
    ),
  ).toMatchObject({ name: "Sibling" });
  expect(
    normalizeProjectWidget({
      name: "Escape",
      summary: "данные наружу",
      template: "<div />",
      data: { leak: "../../.env" },
    }),
  ).toMatchObject({ name: "Escape" });
});

test("trust covers the script field of a project widget", async () => {
  await writeWidgets([{ ...metrics, script: "return { ok: true };" }]);
  expect((await projectWidgetState("p1")).widgets[0]).toMatchObject({
    script: "return { ok: true };",
  });
  expect((await setProjectWidgetTrust("p1", true)).trusted).toBe(true);
  await writeWidgets([{ ...metrics, script: "return { ok: false };" }]);
  expect((await projectWidgetState("p1")).trusted).toBe(false);
  expect(await trustedProjectWidgets("p1")).toEqual([]);
});

test("a project widget may keep its script in a separate field", () => {
  const script = "const n = ref(1); return { n };";
  expect(
    normalizeProjectWidget({
      name: "Scripted",
      summary: "свой скрипт",
      script,
      template: '<Stat :value="n" />',
    }),
  ).toMatchObject({ name: "Scripted", script });
  expect(
    normalizeProjectWidget({
      name: "TooLong",
      summary: "слишком длинный скрипт",
      script: "x".repeat(PROJECT_WIDGET_LIMITS.script + 1),
      template: "<div />",
    }),
  ).toBeUndefined();
  expect(
    normalizeProjectWidget({
      name: "InlineScript",
      summary: "скрипт внутри шаблона запрещён",
      script,
      template: "<script>alert(1)</script><div />",
    }),
  ).toBeUndefined();
});

test("widget data files are read only for a trusted widget and never from secrets", async () => {
  await writeWidgets([metrics]);
  await writeFile(join(project, "metrics.json"), JSON.stringify({ speed: 42 }), "utf8");
  await setProjectWidgetTrust("p1", true);
  expect(await projectWidgetData("p1", "ModelMetrics")).toEqual({
    data: { metrics: { speed: 42 } },
    errors: {},
  });

  await writeWidgets([
    {
      ...metrics,
      data: { metrics: "metrics.json", secret: ".env" },
    },
  ]);
  await setProjectWidgetTrust("p1", true);
  const data = await projectWidgetData("p1", "ModelMetrics");
  expect(data.data.metrics).toEqual({ speed: 42 });
  expect(data.errors.secret).toContain("секрет");

  const outside = join(directory, "outside.json");
  await writeFile(outside, JSON.stringify({ ok: true }), "utf8");
  await symlink(outside, join(project, "escape.json"));
  await writeWidgets([{ ...metrics, data: { escape: "escape.json" } }]);
  await setProjectWidgetTrust("p1", true);
  expect((await projectWidgetData("p1", "ModelMetrics")).errors.escape).toContain("пределы");

  await writeFile(join(project, ".env"), "SECRET=1", "utf8");
  await symlink(join(project, ".env"), join(project, "innocent.json"));
  await writeWidgets([{ ...metrics, data: { innocent: "innocent.json" } }]);
  await setProjectWidgetTrust("p1", true);
  expect((await projectWidgetData("p1", "ModelMetrics")).errors.innocent).toContain("секрет");
});

test("the prompt guide lists project widgets and keeps special ones on demand", () => {
  const definition = normalizeProjectWidget(metrics, []);
  const normal = normalizeProjectWidget(
    {
      name: "ProjectTrace",
      summary: "обычный виджет проекта",
      template: "<div />",
      example: "<ProjectTrace />",
    },
    [],
  );
  expect(definition).toBeDefined();
  expect(normal).toBeDefined();
  const guide = renderWidgetGuide([definition, normal]);
  expect(guide).toContain("Виджеты проекта");
  expect(guide).toContain("ProjectTrace — обычный виджет проекта");
  expect(guide).toContain("ModelMetrics — метрики модели");
  expect(guide).toContain("Специальные виджеты проекта");
  expect(guide).not.toContain("template");
  const catalog = createWidgetCatalog();
  expect(catalog.describe("ModelMetrics", [definition])).toContain("model: string");
  expect(catalog.extraGuide([definition])).toContain("Специальные виджеты проекта");
});
