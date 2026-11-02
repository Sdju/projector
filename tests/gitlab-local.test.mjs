import { afterAll, expect, onTestFinished, test, vi } from "vite-plus/test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { once } from "node:events";
import { execFileSync } from "node:child_process";

process.env.PROJECTOR_SECRET_STORE = "file";

const root = await mkdtemp(join(tmpdir(), "projector-gitlab-local-"));
process.env.XDG_DATA_HOME = join(root, "data");
const { projectGitlabRepository } = await import("../server/modules/workspace/index.ts");
const { updateIntegration } = await import("../server/modules/integration-store/index.ts");
const { searchGitlabProjects } = await import("../server/modules/gitlab/index.ts");
const { launchItem, searchLauncher } = await import("../server/modules/launcher/index.ts");
const { handleApi } = await import("../server/app/api.ts");

afterAll(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

async function configure(url, token = "") {
  await updateIntegration("gitlab", () => ({
    enabled: true,
    settings: { url, directory: join(root, "projects") },
    credentials: token ? { token, login: "tester" } : {},
  }));
}

function gitRepository() {
  return mkdtemp(join(root, "repository-")).then((base) => {
    execFileSync("git", ["-C", base, "init", "-q"]);
    const remote = (...args) =>
      execFileSync("git", ["-C", base, "remote", ...args], { encoding: "utf8" });
    return { base, remote };
  });
}

test("projectGitlabRepository accepts the configured instance and strips its install prefix", async () => {
  const { base, remote } = await gitRepository();
  expect(await projectGitlabRepository(base)).toBe(null);

  remote("add", "origin", "https://gitlab.com/group/sub/project.git");
  expect(await projectGitlabRepository(base)).toStrictEqual({
    instance: "gitlab.com",
    path: "group/sub/project",
  });

  await configure("https://git.example.com/gitlab", "glpat-never-return");
  remote("set-url", "origin", "https://git.example.com/gitlab/team/sub/app.git");
  expect(await projectGitlabRepository(base)).toStrictEqual({
    instance: "git.example.com",
    path: "team/sub/app",
  });

  remote("set-url", "origin", "git@git.example.com:team/sub/app.git");
  const ssh = await projectGitlabRepository(base);
  expect(ssh).toStrictEqual({ instance: "git.example.com", path: "team/sub/app" });
  expect(JSON.stringify(ssh)).not.toContain("glpat-never-return");

  // SSH carries no web port: the host still identifies an instance configured with one.
  await configure("https://git.example.com:8443/gitlab", "glpat-never-return");
  expect(await projectGitlabRepository(base)).toStrictEqual({
    instance: "git.example.com:8443",
    path: "team/sub/app",
  });

  // Another host is rejected even when its remote looks like a valid GitLab project.
  remote("set-url", "origin", "https://github.com/owner/repository.git");
  expect(await projectGitlabRepository(base)).toBe(null);
  remote("set-url", "origin", "https://evil.example.com/team/sub/app.git");
  expect(await projectGitlabRepository(base)).toBe(null);
});

test("GET /api/projects/:id/gitlab returns the local origin without a token", async () => {
  await configure("https://gitlab.com");
  const { base, remote } = await gitRepository();
  remote("add", "origin", "https://gitlab.com/team/app.git");
  const server = createServer((req, res) => void handleApi(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const address = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = "GET", body) =>
    fetch(address + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const resolved = await (await request("/api/projects/resolve", "POST", { path: base })).json();
  const response = await request(`/api/projects/${resolved.project.id}/gitlab`);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toStrictEqual({
    repository: { instance: "gitlab.com", path: "team/app" },
  });
  const github = await (await request(`/api/projects/${resolved.project.id}/github`)).json();
  expect(github).toStrictEqual({ repository: null });
});

test("GitLab search finds an exact project by full path before broad search", async () => {
  await configure("https://gitlab.com");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const address = String(url);
    if (address.endsWith(`/projects/${encodeURIComponent("gitlab-org/gitlab")}`))
      return Response.json({
        path_with_namespace: "gitlab-org/gitlab",
        description: "GitLab",
        visibility: "public",
        web_url: "https://gitlab.com/gitlab-org/gitlab",
      });
    if (address.includes("/projects?")) return Response.json([]);
    return Response.json({}, { status: 404 });
  });
  const hits = await searchGitlabProjects("gitlab-org/gitlab");
  expect(hits).toHaveLength(1);
  expect(hits[0]).toMatchObject({
    fullName: "gitlab-org/gitlab",
    instance: "gitlab.com",
    private: false,
  });
});

test("GitLab group search lists the group projects", async () => {
  await configure("https://gitlab.com");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const address = String(url);
    if (address.endsWith("/groups/gitlab-org")) return Response.json({ id: 42 });
    if (address.includes("/groups/42/projects"))
      return Response.json([
        {
          path_with_namespace: "gitlab-org/gitlab",
          description: "GitLab",
          visibility: "public",
          web_url: "https://gitlab.com/gitlab-org/gitlab",
        },
      ]);
    if (address.includes("/projects?")) return Response.json([]);
    return Response.json({}, { status: 404 });
  });
  const hits = await searchGitlabProjects("gitlab-org/");
  expect(hits).toHaveLength(1);
  expect(hits[0]).toMatchObject({ fullName: "gitlab-org/gitlab", instance: "gitlab.com" });
});

test("GitLab palette results open the readonly workspace instead of cloning", async () => {
  await configure("https://gitlab.com");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const address = String(url);
    expect(address.startsWith("https://gitlab.com/api/v4/")).toBe(true);
    return Response.json([
      {
        path_with_namespace: "team/app",
        description: "Tool",
        visibility: "public",
        web_url: "https://gitlab.com/team/app",
      },
    ]);
  });
  const hits = await searchGitlabProjects("team/app");
  expect(hits).toHaveLength(1);
  expect(hits[0]).toMatchObject({ fullName: "team/app", instance: "gitlab.com" });

  const results = await searchLauncher("gl/team/app");
  expect(results.warning).toBe(undefined);
  expect(results.items).toHaveLength(1);
  expect(results.items[0]).toMatchObject({
    id: "gl:gitlab.com/team/app",
    kind: "gitlab",
    actions: [{ id: "open", title: "Открыть проект GitLab" }],
  });

  const opened = await launchItem(results.items[0].id, "open", true);
  expect(opened.route).toBe("/gl/projects/gitlab.com/team/app");
  expect(await readdir(join(root, "projects")).catch(() => [])).toStrictEqual([]);
});
