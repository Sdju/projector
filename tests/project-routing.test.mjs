import assert from "node:assert/strict";
import { test } from "node:test";
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
    routes: [
      { path: "/projects/:projectPath(.*)+", name: "project", component: {} },
    ],
  });
  for (const path of ["/", "/tmp/nested/project", "/tmp/проект # ? %/child", "/tmp/%2F"]) {
    const route = router.resolve(projectRoute(path));
    assert.equal(route.name, "project");
    assert.equal(route.query && Object.keys(route.query).length, 0);
    assert.equal(route.hash, "");
    assert.equal(projectPathFromParams(route.params.projectPath), path);
  }
});

test("Windows project URLs use one segment per directory and restore native separators", () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/projects/:projectPath(.*)+", name: "project", component: {} }],
  });
  const path = "C:\\Users\\DChernov\\home\\pr\\my\\projector";
  const route = router.resolve(projectRoute(path));
  assert.equal(route.href.includes("%5C"), false);
  assert.equal(route.href, "/projects/C:/Users/DChernov/home/pr/my/projector");
  assert.equal(projectPathFromParams(route.params.projectPath), path);
  assert.equal(projectPathFromParams("C:\\Users\\DChernov\\home\\pr\\my\\projector"), path);
  assert.equal(projectRoute("C:\\"), "/projects/C:");
  assert.equal(projectPathFromParams(["C:"]), "C:\\");
  const unc = "\\\\server\\share\\dir";
  assert.equal(projectPathFromParams(router.resolve(projectRoute(unc)).params.projectPath), unc);
  assert.deepEqual(projectRefSegments(parseProjectRef(path)), [
    { name: "C:", path: "C:\\" },
    { name: "Users", path: "C:\\Users" },
    { name: "DChernov", path: "C:\\Users\\DChernov" },
    { name: "home", path: "C:\\Users\\DChernov\\home" },
    { name: "pr", path: "C:\\Users\\DChernov\\home\\pr" },
    { name: "my", path: "C:\\Users\\DChernov\\home\\pr\\my" },
    { name: "projector", path: "C:\\Users\\DChernov\\home\\pr\\my\\projector" },
  ]);
  const reserved = "C:\\tmp\\проект # ? %\\child";
  assert.equal(
    projectPathFromParams(router.resolve(projectRoute(reserved)).params.projectPath),
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
    assert.equal(saved.id, "saved-id");
    assert.equal(saved.name, "Custom name");
    assert.equal(saved.commands[0].cmd, "custom-command");
    const responses = await Promise.all([resolve(newPath), resolve(newPath)]);
    assert.ok(responses.every((res) => res.status === 200));
    const [first, second] = await Promise.all(responses.map((res) => res.json()));
    assert.equal(first.project.id, second.project.id);
    assert.equal(first.project.path, newPath);
    assert.equal((await loadProjects()).length, 2);
    const tree = await fetch(`${base}/api/projects/${first.project.id}/workspace/tree`);
    assert.equal(tree.status, 200);
    const pkgPath = join(root, "node-project");
    await mkdir(pkgPath);
    await writeFile(
      join(pkgPath, "package.json"),
      JSON.stringify({ name: "node-app", scripts: { dev: "vite" } }),
    );
    const pkg = (await (await resolve(pkgPath)).json()).project;
    assert.equal(pkg.name, "node-app");
    assert.equal(pkg.commands[0].name, "dev");
    assert.equal((await resolve(join(root, "missing"))).status, 400);
    assert.equal((await resolve("")).status, 400);
    assert.equal((await loadProjects()).length, 3);
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
    assert.equal(resolved.project.id, "gone-id");
    assert.equal(resolved.missing, true);
    assert.equal(
      (await (await post("/api/projects/resolve", { path: other })).json()).missing,
      false,
    );

    assert.equal((await post("/api/projects/gone-id/directory", { mode: "bogus" })).status, 400);
    assert.equal((await post("/api/projects/gone-id/directory", { mode: "create" })).status, 200);
    assert.equal((await stat(gone)).isDirectory(), true);
    assert.equal(
      (await (await post("/api/projects/resolve", { path: gone })).json()).missing,
      false,
    );

    await rm(gone, { recursive: true });
    const target = join(root, "moved", "deep");
    assert.equal(
      (await post("/api/projects/gone-id/directory", { mode: "relocate", path: target })).status,
      400,
    );
    assert.equal(
      (await post("/api/projects/gone-id/directory", { mode: "relocate", path: "" })).status,
      400,
    );
    assert.equal(
      (await post("/api/projects/gone-id/directory", { mode: "relocate", path: other })).status,
      409,
    );
    const moved = await post("/api/projects/gone-id/directory", {
      mode: "relocate",
      path: target,
      create: true,
    });
    assert.equal(moved.status, 200);
    assert.equal((await moved.json()).project.path, target);
    assert.equal((await stat(target)).isDirectory(), true);
    assert.equal((await loadProjects()).find((item) => item.id === "gone-id").path, target);
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
  assert.deepEqual(
    draft.commands.map((command) => command.id),
    ["custom", "build"],
  );
  assert.equal(draft.defaultCommandId, "custom");
  assert.equal(project.commands.length, 1);
  assert.equal(settingsError(draft), "");
  assert.match(settingsError({ ...draft, mode: "window" }), /адрес/);
  assert.match(settingsError({ ...draft, url: "javascript:alert(1)" }), /http/);
  assert.match(
    settingsError({ ...draft, commands: [{ id: "custom", name: "dev", cmd: " " }] }),
    /команда запуска/,
  );
});

test("command discovery reads all actual scripts without running them or inventing commands", async () => {
  const { inspectProjectCommands } = await import("../server/modules/projects/index.ts");
  const { normalizeProject } = await import("../server/modules/project-presentation/index.ts");
  const root = await mkdtemp(join(tmpdir(), "projector-settings-"));
  try {
    assert.deepEqual(await inspectProjectCommands(root), []);
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
    assert.deepEqual(
      commands.map(({ name, cmd }) => [name, cmd]),
      [
        ["dev", "pnpm dev"],
        ["test", "pnpm test"],
        ["build", "pnpm build"],
      ],
    );
    const { readdir } = await import("node:fs/promises");
    assert.equal((await readdir(root)).includes("should-never-run"), false);
    await writeFile(join(root, "package.json"), "{}");
    assert.deepEqual(await inspectProjectCommands(root), []);
    await assert.rejects(inspectProjectCommands(join(root, "missing")), /Папка не найдена/);
    const project = normalizeProject({ name: "App", path: root, icon: "old.svg", commands });
    const saved = normalizeProject({ ...project, icon: "" }, project);
    assert.equal(saved.icon, "");
    assert.equal(saved.id, project.id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
