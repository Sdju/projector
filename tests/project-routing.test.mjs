import { expect, test } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { createRouter, createMemoryHistory } from "vue-router";
import { projectRoute, projectPathFromParams } from "../src/modules/project/project-route.ts";
import { parseProjectRef, projectRefSegments } from "../core/modules/project/index.ts";

test("project URLs round-trip nested paths, root and reserved characters", () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/projects/:projectPath(.*)+", name: "project", component: {} }],
  });
  for (const path of ["/", "/tmp/nested/project", "/tmp/проект # ? %/child", "/tmp/%2F"]) {
    const route = router.resolve(projectRoute(path));
    expect(route.name).toBe("project");
    expect(route.query && Object.keys(route.query).length).toBe(0);
    expect(route.hash).toBe("");
    expect(projectPathFromParams(route.params.projectPath)).toBe(path);
  }
});

test("Windows project URLs use one segment per directory and restore native separators", () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/projects/:projectPath(.*)+", name: "project", component: {} }],
  });
  const path = "C:\\Users\\DChernov\\home\\pr\\my\\projector";
  const route = router.resolve(projectRoute(path));
  expect(route.href.includes("%5C")).toBe(false);
  expect(route.href).toBe("/projects/C:/Users/DChernov/home/pr/my/projector");
  expect(projectPathFromParams(route.params.projectPath)).toBe(path);
  expect(projectPathFromParams("C:\\Users\\DChernov\\home\\pr\\my\\projector")).toBe(path);
  expect(projectRoute("C:\\")).toBe("/projects/C:");
  expect(projectPathFromParams(["C:"])).toBe("C:\\");
  const unc = "\\\\server\\share\\dir";
  expect(projectPathFromParams(router.resolve(projectRoute(unc)).params.projectPath)).toBe(unc);
  expect(projectRefSegments(parseProjectRef(path))).toStrictEqual([
    { name: "C:", path: "C:\\" },
    { name: "Users", path: "C:\\Users" },
    { name: "DChernov", path: "C:\\Users\\DChernov" },
    { name: "home", path: "C:\\Users\\DChernov\\home" },
    { name: "pr", path: "C:\\Users\\DChernov\\home\\pr" },
    { name: "my", path: "C:\\Users\\DChernov\\home\\pr\\my" },
    { name: "projector", path: "C:\\Users\\DChernov\\home\\pr\\my\\projector" },
  ]);
  const reserved = "C:\\tmp\\проект # ? %\\child";
  expect(projectPathFromParams(router.resolve(projectRoute(reserved)).params.projectPath)).toBe(
    reserved,
  );
});

test("opening a path reuses saved settings and resolves arbitrary directories once", async () => {
  const root = await mkdtemp(join(tmpdir(), "projector-routing-"));
  const previousDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = root;
  const { handleApi } = await import("../server/app/api.ts");
  const { loadProjects } = await import("../server/modules/projects/index.ts");
  const server = createServer((req, res) => {
    void handleApi(req, res).then((handled) => {
      if (!handled) res.writeHead(404).end();
    });
  });
  try {
    const savedPath = join(root, "saved");
    const newPath = join(root, "вложенный # ? %", "project");
    await mkdir(savedPath);
    await mkdir(newPath, { recursive: true });
    await mkdir(join(root, "projector"));
    await writeFile(
      join(root, "projector", "projects.json"),
      JSON.stringify({
        projects: [
          {
            id: "saved-id",
            name: "Custom name",
            path: savedPath,
            url: "http://localhost:9999",
            commands: [{ id: "command", name: "custom", cmd: "custom-command" }],
            defaultCommandId: "command",
            mode: "server",
            createdAt: "",
          },
        ],
      }),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const resolve = (path) =>
      fetch(`${base}/api/projects/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
    const saved = (await (await resolve(`${savedPath}/../saved/`)).json()).project;
    expect(saved.id).toBe("saved-id");
    expect(saved.name).toBe("Custom name");
    expect(saved.commands[0].cmd).toBe("custom-command");
    const responses = await Promise.all([resolve(newPath), resolve(newPath)]);
    expect(responses.every((res) => res.status === 200)).toBeTruthy();
    const [first, second] = await Promise.all(responses.map((res) => res.json()));
    expect(first.project.id).toBe(second.project.id);
    expect(first.project.path).toBe(newPath);
    expect((await loadProjects()).length).toBe(2);
    const tree = await fetch(`${base}/api/projects/${first.project.id}/workspace/tree`);
    expect(tree.status).toBe(200);
    const pkgPath = join(root, "node-project");
    await mkdir(pkgPath);
    await writeFile(
      join(pkgPath, "package.json"),
      JSON.stringify({ name: "node-app", scripts: { dev: "vite" } }),
    );
    const pkg = (await (await resolve(pkgPath)).json()).project;
    expect(pkg.name).toBe("node-app");
    expect(pkg.commands[0].name).toBe("dev");
    expect((await resolve(join(root, "missing"))).status).toBe(400);
    expect((await resolve("")).status).toBe(400);
    expect((await loadProjects()).length).toBe(3);
  } finally {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    await rm(root, { recursive: true, force: true });
  }
});

test("a project whose folder disappeared can recreate it or move to a new path", async () => {
  const root = await mkdtemp(join(tmpdir(), "projector-missing-"));
  const previousDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = root;
  const { handleApi } = await import("../server/app/api.ts");
  const { loadProjects } = await import("../server/modules/projects/index.ts");
  const server = createServer((req, res) => {
    void handleApi(req, res).then((handled) => {
      if (!handled) res.writeHead(404).end();
    });
  });
  try {
    const gone = join(root, "gone");
    const other = join(root, "other");
    await mkdir(join(root, "projector"));
    await mkdir(other);
    const entry = (id, path) => ({
      id,
      name: id,
      path,
      url: "",
      commands: [{ id: "c", name: "dev", cmd: "true" }],
      defaultCommandId: "c",
      mode: "server",
      createdAt: "",
    });
    await writeFile(
      join(root, "projector", "projects.json"),
      JSON.stringify({ projects: [entry("gone-id", gone), entry("other-id", other)] }),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (url, body) =>
      fetch(`${base}${url}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const resolved = await (await post("/api/projects/resolve", { path: gone })).json();
    expect(resolved.project.id).toBe("gone-id");
    expect(resolved.missing).toBe(true);
    expect((await (await post("/api/projects/resolve", { path: other })).json()).missing).toBe(
      false,
    );

    expect((await post("/api/projects/gone-id/directory", { mode: "bogus" })).status).toBe(400);
    expect((await post("/api/projects/gone-id/directory", { mode: "create" })).status).toBe(200);
    expect((await stat(gone)).isDirectory()).toBe(true);
    expect((await (await post("/api/projects/resolve", { path: gone })).json()).missing).toBe(
      false,
    );

    await rm(gone, { recursive: true });
    const target = join(root, "moved", "deep");
    expect(
      (await post("/api/projects/gone-id/directory", { mode: "relocate", path: target })).status,
    ).toBe(400);
    expect(
      (await post("/api/projects/gone-id/directory", { mode: "relocate", path: "" })).status,
    ).toBe(400);
    expect(
      (await post("/api/projects/gone-id/directory", { mode: "relocate", path: other })).status,
    ).toBe(409);
    const moved = await post("/api/projects/gone-id/directory", {
      mode: "relocate",
      path: target,
      create: true,
    });
    expect(moved.status).toBe(200);
    expect((await moved.json()).project.path).toBe(target);
    expect((await stat(target)).isDirectory()).toBe(true);
    expect((await loadProjects()).find((item) => item.id === "gone-id").path).toBe(target);
  } finally {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    await rm(root, { recursive: true, force: true });
  }
});

test("settings import preserves custom commands and does not duplicate scripts", async () => {
  const { missingCommands, projectDraft, settingsError } =
    await import("../src/modules/project/model/project-settings.ts");
  const project = {
    name: "App",
    path: "/tmp/app",
    icon: "",
    url: "",
    mode: "server",
    defaultCommandId: "custom",
    commands: [{ id: "custom", name: "develop", cmd: "pnpm dev" }],
  };
  const draft = projectDraft(project);
  const found = [
    { id: "dev", name: "dev", cmd: "pnpm dev" },
    { id: "custom-name", name: "develop", cmd: "npm run develop" },
    { id: "build", name: "build", cmd: "pnpm build" },
  ];
  draft.commands.push(...missingCommands(draft.commands, found));
  expect(draft.commands.map((command) => command.id)).toStrictEqual(["custom", "build"]);
  expect(draft.defaultCommandId).toBe("custom");
  expect(project.commands.length).toBe(1);
  expect(settingsError(draft)).toBe("");
  expect(settingsError({ ...draft, mode: "window" })).toMatch(/адрес/);
  expect(settingsError({ ...draft, url: "javascript:alert(1)" })).toMatch(/http/);
  expect(settingsError({ ...draft, commands: [{ id: "custom", name: "dev", cmd: " " }] })).toMatch(
    /команда запуска/,
  );
});

test("command discovery reads all actual scripts without running them or inventing commands", async () => {
  const { inspectProjectCommands } = await import("../server/modules/projects/index.ts");
  const { normalizeProject } = await import("../server/modules/project-presentation/index.ts");
  const root = await mkdtemp(join(tmpdir(), "projector-settings-"));
  try {
    expect(await inspectProjectCommands(root)).toStrictEqual([]);
    await writeFile(join(root, "pnpm-lock.yaml"), "");
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        scripts: {
          test: "node --test",
          dev: "touch should-never-run",
          build: "vite build",
          empty: "",
          invalid: 12,
        },
      }),
    );
    const commands = await inspectProjectCommands(root);
    expect(commands.map(({ name, cmd }) => [name, cmd])).toStrictEqual([
      ["dev", "pnpm dev"],
      ["test", "pnpm test"],
      ["build", "pnpm build"],
    ]);
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(root)).includes("should-never-run")).toBe(false);
    await writeFile(join(root, "package.json"), "{}");
    expect(await inspectProjectCommands(root)).toStrictEqual([]);
    await expect(inspectProjectCommands(join(root, "missing"))).rejects.toThrow(/Папка не найдена/);
    const project = normalizeProject({ name: "App", path: root, icon: "old.svg", commands });
    const saved = normalizeProject({ ...project, icon: "" }, project);
    expect(saved.icon).toBe("");
    expect(saved.id).toBe(project.id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
