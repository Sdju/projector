import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { createRouter, createMemoryHistory } from "vue-router";
import { projectRoute, projectPathFromParams } from "../src/modules/catalog/project-route.ts";

test("project URLs round-trip nested paths, root and reserved characters", () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/projects", name: "home", component: {} },
      { path: "/projects/:projectPath(.*)+", name: "project", component: {} },
    ],
  });
  assert.equal(router.resolve("/projects").name, "home");
  for (const path of ["/", "/tmp/nested/project", "/tmp/проект # ? %/child", "/tmp/%2F"]) {
    const route = router.resolve(projectRoute(path));
    assert.equal(route.name, "project");
    assert.equal(route.query && Object.keys(route.query).length, 0);
    assert.equal(route.hash, "");
    assert.equal(projectPathFromParams(route.params.projectPath), path);
  }
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
