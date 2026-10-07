import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { once } from "node:events";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

process.env.PROJECTOR_SECRET_STORE = "file";

await test("GitLab integration connects with a token, searches and imports nested projects", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "projector-gitlab-"));
  process.env.XDG_DATA_HOME = join(root, "data");
  const directory = join(root, "projects");
  const secret = "glpat-never-return";
  const host = "https://git.example.com";
  const nativeFetch = globalThis.fetch;
  mock.method(globalThis, "fetch", async (url, init) => {
    const address = String(url);
    if (!address.startsWith(`${host}/api/v4/`)) return nativeFetch(url, init);
    assert.equal(init.redirect, "error");
    const path = address.slice(`${host}/api/v4`.length);
    if (init.headers["PRIVATE-TOKEN"] !== secret) return Response.json({}, { status: 401 });
    if (path === "/user") return Response.json({ username: "tanuki" });
    if (path.startsWith("/projects?")) {
      const params = new URL(address).searchParams;
      assert.equal(params.get("simple"), "true");
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
    assert.ok(args.includes("core.hooksPath=/dev/null"));
    assert.ok(!JSON.stringify(args).includes(secret));
    assert.equal(options.env.PROJECTOR_GITLAB_TOKEN, secret);
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
  t.after(async () => {
    server.close();
    mock.restoreAll();
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
    assert.ok(!JSON.stringify(data).includes(secret), "Public API must not expose token");
    return { status: res.status, data };
  }

  assert.equal((await request("/gitlab/repositories")).status, 400);
  assert.equal(
    (await request("/gitlab", "PUT", { enabled: true, url: "ftp://x", directory })).status,
    400,
  );
  assert.equal(
    (await request("/gitlab", "PUT", { enabled: true, url: `${host}/`, directory })).status,
    200,
  );
  assert.equal((await request("/gitlab/repositories")).status, 401);
  assert.equal((await request("/gitlab/auth", "POST", { token: "wrong" })).status, 401);
  const connected = await request("/gitlab/auth", "POST", { token: secret });
  assert.equal(connected.data.account, "tanuki");
  assert.equal(connected.data.settings.url, host);
  const listed = (await request("/gitlab/repositories")).data;
  assert.equal(listed.repositories[0].fullName, "team/tools/app");
  assert.equal(listed.repositories[0].private, true);

  const { searchGitlabProjects } = await import("../server/modules/gitlab/index.ts");
  for (const query of ["", "team/", "TEAM/to", "to", "tools/app", "app"])
    assert.deepEqual(
      (await searchGitlabProjects(query)).map((hit) => hit.fullName),
      ["team/tools/app"],
      query,
    );
  for (const query of ["other/", "zzz", "team/zzz"])
    assert.deepEqual(await searchGitlabProjects(query), [], query);

  assert.equal((await request("/gitlab/import", "POST", { repository: "a/../b" })).status, 400);
  assert.equal(
    (await request("/gitlab/import", "POST", { repository: "team/missing" })).status,
    404,
  );
  const imported = await request("/gitlab/import", "POST", {
    repository: `${host}/team/tools/app/-/tree/main`,
  });
  assert.equal(imported.status, 201, JSON.stringify(imported.data));
  assert.equal(imported.data.project.path, join(directory, "team", "tools", "app"));
  assert.equal(imported.data.project.commands[0].cmd.includes("dev"), true);
  assert.deepEqual(clones, [`${host}/team/tools/app.git`]);
  assert.equal(
    (await request("/gitlab/import", "POST", { repository: "team/tools/app" })).status,
    409,
  );

  // Another instance address drops the token that belonged to the old one.
  const moved = await request("/gitlab", "PUT", {
    enabled: true,
    url: "https://other.example.com",
    directory,
  });
  assert.equal(moved.data.connected, false);
});
