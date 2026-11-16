import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "vite-plus/test";

test("scenarios move from the shared catalog into the project", async () => {
  const root = await mkdtemp(join(tmpdir(), "projector-scenarios-store-"));
  const previous = process.env.XDG_DATA_HOME;
  const data = join(root, "data");
  process.env.XDG_DATA_HOME = data;
  onTestFinished(async () => {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(root, { recursive: true, force: true });
  });

  const projectPath = join(root, "project");
  await mkdir(join(projectPath, ".projector"), { recursive: true });
  await mkdir(join(data, "projector"), { recursive: true });
  const catalog = join(data, "projector", "projects.json");
  await writeFile(
    catalog,
    JSON.stringify({
      projects: [
        {
          id: "p1",
          name: "Проект",
          path: projectPath,
          url: "",
          icon: "",
          mode: "server",
          defaultCommandId: "dev",
          commands: [{ id: "dev", name: "dev", cmd: "pnpm dev" }],
          createdAt: "2026-01-01",
        },
      ],
    }),
  );

  const { loadProjects, updateProjects } = await import("../modules/projects/store.ts");
  const [loaded] = await loadProjects();
  expect(loaded.commands[0].cmd).toBe("pnpm dev");
  expect(loaded.defaultCommandId).toBe("dev");
  const scenarios = JSON.parse(
    await readFile(join(projectPath, ".projector/scenarios.json"), "utf8"),
  );
  expect(scenarios).toEqual({
    version: 1,
    commands: [{ id: "dev", name: "dev", cmd: "pnpm dev" }],
    defaultCommandId: "dev",
  });

  await updateProjects((projects) => {
    projects[0].name = "Другое имя";
  });
  const saved = JSON.parse(await readFile(catalog, "utf8"));
  expect(saved.projects[0]).toMatchObject({ id: "p1", name: "Другое имя" });
  expect(saved.projects[0].commands).toBeUndefined();
  expect(saved.projects[0].defaultCommandId).toBeUndefined();

  await writeFile(
    join(projectPath, ".projector/scenarios.json"),
    JSON.stringify({
      version: 1,
      commands: [{ id: "start", name: "start", cmd: "pnpm start" }],
      defaultCommandId: "start",
    }),
  );
  const [reloaded] = await loadProjects();
  expect(reloaded.commands[0]).toMatchObject({ id: "start", cmd: "pnpm start" });
  expect(reloaded.defaultCommandId).toBe("start");
});

test("editing scenarios writes the project file, not the catalog", async () => {
  const root = await mkdtemp(join(tmpdir(), "projector-scenarios-edit-"));
  const previous = process.env.XDG_DATA_HOME;
  const data = join(root, "data");
  process.env.XDG_DATA_HOME = data;
  onTestFinished(async () => {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(root, { recursive: true, force: true });
  });

  const projectPath = join(root, "project");
  await mkdir(projectPath, { recursive: true });
  await mkdir(join(data, "projector"), { recursive: true });
  const catalog = join(data, "projector", "projects.json");
  await writeFile(
    catalog,
    JSON.stringify({
      projects: [
        {
          id: "p1",
          name: "Проект",
          path: projectPath,
          url: "",
          icon: "",
          mode: "server",
          defaultCommandId: "",
          commands: [],
          createdAt: "2026-01-01",
        },
      ],
    }),
  );

  const { loadProjects, updateProjects } = await import("../modules/projects/store.ts");
  await loadProjects();
  await updateProjects((projects) => {
    projects[0].commands = [{ id: "test", name: "test", cmd: "pnpm test" }];
    projects[0].defaultCommandId = "test";
  });

  const scenarios = JSON.parse(
    await readFile(join(projectPath, ".projector/scenarios.json"), "utf8"),
  );
  expect(scenarios).toEqual({
    version: 1,
    commands: [{ id: "test", name: "test", cmd: "pnpm test" }],
    defaultCommandId: "test",
  });
  const saved = JSON.parse(await readFile(catalog, "utf8"));
  expect(saved.projects[0].commands).toBeUndefined();
  expect(saved.projects[0].defaultCommandId).toBeUndefined();
});

test("opening a project prefers its own scenarios file", async () => {
  const root = await mkdtemp(join(tmpdir(), "projector-scenarios-inspect-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".projector"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "demo", scripts: { dev: "vite" } }),
  );
  await writeFile(
    join(root, ".projector/scenarios.json"),
    JSON.stringify({
      version: 1,
      commands: [{ id: "serve", name: "serve", cmd: "pnpm serve" }],
      defaultCommandId: "serve",
    }),
  );
  const { inspectProject } = await import("../modules/projects/inspect.ts");
  const inspected = await inspectProject(root);
  expect(inspected.name).toBe("demo");
  expect(inspected.commands).toEqual([{ id: "serve", name: "serve", cmd: "pnpm serve" }]);
  expect(inspected.defaultCommandId).toBe("serve");
});

test("an empty scenarios file is restored from the catalog", async () => {
  const root = await mkdtemp(join(tmpdir(), "projector-scenarios-empty-"));
  const previous = process.env.XDG_DATA_HOME;
  const data = join(root, "data");
  process.env.XDG_DATA_HOME = data;
  onTestFinished(async () => {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(root, { recursive: true, force: true });
  });

  const projectPath = join(root, "project");
  await mkdir(join(projectPath, ".projector"), { recursive: true });
  await mkdir(join(data, "projector"), { recursive: true });
  await writeFile(
    join(data, "projector", "projects.json"),
    JSON.stringify({
      projects: [
        {
          id: "p1",
          name: "Проект",
          path: projectPath,
          url: "",
          icon: "",
          mode: "server",
          defaultCommandId: "dev",
          commands: [{ id: "dev", name: "dev", cmd: "pnpm dev" }],
          createdAt: "2026-01-01",
        },
      ],
    }),
  );
  const file = join(projectPath, ".projector/scenarios.json");
  await writeFile(file, JSON.stringify({ version: 1, commands: [], defaultCommandId: "" }));

  const { loadProjects } = await import("../modules/projects/store.ts");
  const [loaded] = await loadProjects();
  expect(loaded.commands[0].cmd).toBe("pnpm dev");
  expect(JSON.parse(await readFile(file, "utf8")).commands).toEqual([
    { id: "dev", name: "dev", cmd: "pnpm dev" },
  ]);

  const { writeProjectScenarios } = await import("../modules/projects/scenarios.ts");
  await expect(
    writeProjectScenarios(projectPath, { commands: [], defaultCommandId: "" }),
  ).rejects.toThrow(/хотя бы одна/);
});

test("a missing project keeps its scenarios until the folder returns", async () => {
  const root = await mkdtemp(join(tmpdir(), "projector-scenarios-gone-"));
  const previous = process.env.XDG_DATA_HOME;
  const data = join(root, "data");
  process.env.XDG_DATA_HOME = data;
  onTestFinished(async () => {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(root, { recursive: true, force: true });
  });

  const projectPath = join(root, "gone");
  await mkdir(join(data, "projector"), { recursive: true });
  const catalog = join(data, "projector", "projects.json");
  await writeFile(
    catalog,
    JSON.stringify({
      projects: [
        {
          id: "p1",
          name: "Проект",
          path: projectPath,
          url: "",
          icon: "",
          mode: "server",
          defaultCommandId: "dev",
          commands: [{ id: "dev", name: "dev", cmd: "pnpm dev" }],
          createdAt: "2026-01-01",
        },
      ],
    }),
  );

  const { loadProjects, updateProjects } = await import("../modules/projects/store.ts");
  expect((await loadProjects())[0].commands[0].cmd).toBe("pnpm dev");
  await expect(stat(projectPath)).rejects.toMatchObject({ code: "ENOENT" });

  await updateProjects((projects) => {
    projects[0].name = "Другое имя";
  });
  const saved = JSON.parse(await readFile(catalog, "utf8"));
  expect(saved.projects[0].commands).toEqual([{ id: "dev", name: "dev", cmd: "pnpm dev" }]);

  await mkdir(projectPath);
  await updateProjects(() => {});
  const scenarios = JSON.parse(
    await readFile(join(projectPath, ".projector/scenarios.json"), "utf8"),
  );
  expect(scenarios.commands).toEqual([{ id: "dev", name: "dev", cmd: "pnpm dev" }]);
  expect(JSON.parse(await readFile(catalog, "utf8")).projects[0].commands).toBeUndefined();
});
