import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { once } from "node:events";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

process.env.PROJECTOR_SECRET_STORE = "file";

test("GitLab integration connects with a token, searches and imports nested projects", async () => {
  const root = await mkdtemp(join(tmpdir(), "projector-gitlab-"));
  process.env.XDG_DATA_HOME = join(root, "data");
  const directory = join(root, "projects");
  const secret = "glpat-never-return";
  const host = "https://git.example.com";
  const nativeFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const address = String(url);
    if (!address.startsWith(`${host}/api/v4/`)) return nativeFetch(url, init);
    expect(init.redirect).toBe("error");
    const path = address.slice(`${host}/api/v4`.length);
    if (init.headers["PRIVATE-TOKEN"] !== secret) return Response.json({}, { status: 401 });
    if (path === "/user") return Response.json({ username: "tanuki" });
    if (path.startsWith("/projects?")) {
      const params = new URL(address).searchParams;
      expect(params.get("simple")).toBe("true");
      return Response.json([
        {
          path_with_namespace: "team/tools/app",
          description: "Tool",
          visibility: "private",
          web_url: `${host}/team/tools/app`,
        },
      ]);
    }
    if (path === `/projects/${encodeURIComponent("team/tools/app")}`)
      return Response.json({
        path_with_namespace: "team/tools/app",
        http_url_to_repo: `${host}/team/tools/app.git`,
      });
    return Response.json({}, { status: 404 });
  });
  const nativeExec = childProcess.execFile;
  const clones = [];
  childProcess.execFile = (command, args, options, callback) => {
    if (command !== "git") return nativeExec(command, args, options, callback);
    clones.push(args.at(-2));
    expect(args.includes("core.hooksPath=/dev/null")).toBeTruthy();
    expect(!JSON.stringify(args).includes(secret)).toBeTruthy();
    expect(options.env.PROJECTOR_GITLAB_TOKEN).toBe(secret);
    void (async () => {
      await mkdir(args.at(-1), { recursive: true });
      await writeFile(
        join(args.at(-1), "package.json"),
        JSON.stringify({ name: "app", scripts: { dev: "vite" } }),
      );
      callback(null, "", "");
    })().catch(callback);
    return { on() {} };
  };
  syncBuiltinESMExports();
  const { handleApi } = await import("../server/app/api.ts");
  const server = createServer((req, res) => void handleApi(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(async () => {
    server.close();
    vi.restoreAllMocks();
    childProcess.execFile = nativeExec;
    syncBuiltinESMExports();
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, method = "GET", body) {
    const res = await nativeFetch(`${base}/api/integrations${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json();
    expect(!JSON.stringify(data).includes(secret), "Public API must not expose token").toBeTruthy();
    return { status: res.status, data };
  }

  expect((await request("/gitlab/repositories")).status).toBe(400);
  expect(
    (await request("/gitlab", "PUT", { enabled: true, url: "ftp://x", directory })).status,
  ).toBe(400);
  expect(
    (await request("/gitlab", "PUT", { enabled: true, url: `${host}/`, directory })).status,
  ).toBe(200);
  expect((await request("/gitlab/repositories")).status).toBe(401);
  expect((await request("/gitlab/auth", "POST", { token: "wrong" })).status).toBe(401);
  const connected = await request("/gitlab/auth", "POST", { token: secret });
  expect(connected.data.account).toBe("tanuki");
  expect(connected.data.settings.url).toBe(host);
  const listed = (await request("/gitlab/repositories")).data;
  expect(listed.repositories[0].fullName).toBe("team/tools/app");
  expect(listed.repositories[0].private).toBe(true);

  const { searchGitlabProjects } = await import("../server/modules/gitlab/index.ts");
  for (const query of ["", "team/", "TEAM/to", "to", "tools/app", "app"])
    expect(
      (await searchGitlabProjects(query)).map((hit) => hit.fullName),
      query,
    ).toStrictEqual(["team/tools/app"]);
  for (const query of ["other/", "zzz", "team/zzz"])
    expect(await searchGitlabProjects(query), query).toStrictEqual([]);

  expect((await request("/gitlab/import", "POST", { repository: "a/../b" })).status).toBe(400);
  expect((await request("/gitlab/import", "POST", { repository: "team/missing" })).status).toBe(
    404,
  );
  const imported = await request("/gitlab/import", "POST", {
    repository: `${host}/team/tools/app/-/tree/main`,
  });
  expect(imported.status, JSON.stringify(imported.data)).toBe(201);
  expect(imported.data.project.path).toBe(join(directory, "team", "tools", "app"));
  expect(imported.data.project.commands[0].cmd.includes("dev")).toBe(true);
  expect(clones).toStrictEqual([`${host}/team/tools/app.git`]);
  expect((await request("/gitlab/import", "POST", { repository: "team/tools/app" })).status).toBe(
    409,
  );

  // Another instance address drops the token that belonged to the old one.
  const moved = await request("/gitlab", "PUT", {
    enabled: true,
    url: "https://other.example.com",
    directory,
  });
  expect(moved.data.connected).toBe(false);
});
