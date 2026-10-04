import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, stat, access, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { once } from "node:events";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

await test("GitHub integration persists authorization and imports authenticated repositories", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "projector-integrations-"));
  process.env.XDG_DATA_HOME = join(root, "data");
  const directory = join(root, "projects with spaces");
  const secret = "test-token-never-return";
  let expectedToken = secret;
  const nativeFetch = globalThis.fetch;
  let tokenValid = true;
  let tokenPolls = 0;
  let clock = Date.now();
  let oauthMode = "pending";
  const oauthRequests = [];
  mock.method(Date, "now", () => clock);
  mock.method(globalThis, "fetch", async (url, init) => {
    const address = String(url);
    if (address.startsWith("https://github.com/login/")) {
      oauthRequests.push(Object.fromEntries(init.body));
      if (address.endsWith("device/code"))
        return Response.json({
          device_code: "server-only-code",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5,
        });
      tokenPolls++;
      if (oauthMode === "success") return Response.json({ access_token: secret });
      return Response.json({ error: oauthMode === "slow" ? "slow_down" : "authorization_pending" });
    }
    if (address.startsWith("https://api.github.com/")) {
      assert.equal(init.headers.Authorization, expectedToken ? `Bearer ${expectedToken}` : undefined);
      if (!tokenValid) return Response.json({}, { status: 401 });
      if (address.endsWith("/user")) return Response.json({ login: "octocat" });
      if (address.includes("/user/repos")) {
        const url = new URL(address);
        assert.equal(url.searchParams.get("per_page"), "50");
        return Response.json(
          url.searchParams.get("page") === "2"
            ? []
            : Array.from({ length: 50 }, (_, index) => ({
                full_name: index ? `octocat/app-${index}` : "octocat/app",
                description: "Private app",
                private: true,
                html_url: "https://github.com/octocat/app",
              })),
        );
      }
      if (address.includes("/repos/octocat/missing")) return Response.json({}, { status: 404 });
      return Response.json({ full_name: "octocat/app" });
    }
    return nativeFetch(url, init);
  });
  const nativeExec = childProcess.execFile;
  let clones = 0;
  childProcess.execFile = (command, args, options, callback) => {
    if (command !== "git") return nativeExec(command, args, options, callback);
    clones++;
    assert.ok(args.includes("credential.helper="));
    assert.ok(args.includes("core.hooksPath=/dev/null"));
    assert.ok(args.includes("http.followRedirects=false"));
    assert.ok(!JSON.stringify(args).includes(secret));
    assert.equal(options.env.PROJECTOR_GITHUB_TOKEN, expectedToken);
    assert.equal(options.env.GIT_TERMINAL_PROMPT, "0");
    void (async () => {
      const helper = await readFile(options.env.GIT_ASKPASS, "utf8");
      assert.ok(helper.includes("PROJECTOR_GITHUB_TOKEN"));
      const repo = args.at(-2);
      if (repo.endsWith("/failure.git")) {
        callback(new Error(secret));
        return;
      }
      const destination = args.at(-1);
      await mkdir(destination, { recursive: true });
      if (!repo.endsWith("/plain.git")) {
        await writeFile(
          join(destination, "package.json"),
          JSON.stringify({ name: "imported-app", scripts: { dev: "vite", build: "vite build" } }),
        );
        await writeFile(join(destination, "pnpm-lock.yaml"), "");
      }
      callback(null, "", "");
    })().catch(callback);
    return { on() {} };
  };
  syncBuiltinESMExports();
  const { handleApi } = await import("../server/app/api.ts");
  const server = createServer((req, res) => {
    void handleApi(req, res);
  });
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
  async function request(path, method = "GET", body, headers = {}) {
    const res = await nativeFetch(base + "/api/integrations" + path, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json();
    assert.ok(!JSON.stringify(data).includes(secret), "Public API must not expose token");
    assert.ok(!JSON.stringify(data).includes("server-only-code"));
    return { status: res.status, data, headers: res.headers };
  }
  assert.equal((await request("")).data.integrations[0].enabled, false);
  assert.equal((await request("/github/repositories")).status, 400);
  assert.equal(
    (
      await request(
        "/github",
        "PUT",
        { enabled: true, clientId: "client", directory },
        { Origin: "https://foreign.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (await request("/github", "PUT", { enabled: true, clientId: "client", directory })).status,
    200,
  );
  assert.equal((await request("/github/repositories")).status, 401);
  tokenValid = false;
  assert.equal((await request("/github/auth", "POST", { token: secret })).status, 401);
  assert.equal((await request("")).data.integrations[0].connected, false);
  tokenValid = true;
  assert.equal((await request("/github/auth", "POST", { token: secret })).data.account, "octocat");
  const file = join(root, "data", "projector", "integrations.json");
  assert.equal(
    JSON.parse(await readFile(file, "utf8")).integrations.github.credentials.token,
    secret,
  );
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await request("")).headers.get("cache-control"), "no-store");
  const reloaded = await import("../server/modules/integrations/store.ts?reload-check");
  assert.equal((await reloaded.integrationConfig("github")).credentials.login, "octocat");
  assert.equal((await request("/github/repositories?page=0")).status, 400);
  const firstPage = (await request("/github/repositories")).data;
  assert.equal(firstPage.repositories[0].private, true);
  assert.equal(firstPage.hasMore, true);
  const secondPage = (await request("/github/repositories?page=2")).data;
  assert.equal(secondPage.page, 2);
  assert.equal(secondPage.hasMore, false);
  assert.deepEqual(secondPage.repositories, []);
  assert.equal(
    (await request("/github/import", "POST", { repository: "octocat/../../escape" })).status,
    400,
  );
  assert.equal(
    (await request("/github/import", "POST", { repository: "https://evil.example/x/y" })).status,
    400,
  );
  assert.equal(
    (await request("/github/import", "POST", { repository: "octocat/missing" })).status,
    404,
  );
  const imported = await request("/github/import", "POST", {
    repository: "https://github.com/octocat/app.git",
  });
  assert.equal(imported.status, 201, JSON.stringify(imported.data));
  assert.equal(imported.data.project.path, join(directory, "octocat", "app"));
  assert.equal(imported.data.project.commands[0].cmd, "pnpm dev");
  assert.equal(
    (await request("/github/import", "POST", { repository: "octocat/app" })).status,
    409,
  );
  assert.equal(clones, 1);
  await mkdir(join(directory, "octocat", "existing"));
  assert.equal(
    (await request("/github/import", "POST", { repository: "octocat/existing" })).status,
    409,
  );
  const failure = await request("/github/import", "POST", { repository: "octocat/failure" });
  assert.equal(failure.status, 400);
  await assert.rejects(access(join(directory, "octocat", "failure")));
  const simultaneous = await Promise.all(
    ["one", "two", "plain"].map((name) =>
      request("/github/import", "POST", { repository: `octocat/${name}` }),
    ),
  );
  for (const result of simultaneous) assert.equal(result.status, 201);
  assert.equal(simultaneous[2].data.project.commands[0].cmd, "git status");
  const projects = JSON.parse(
    await readFile(join(root, "data", "projector", "projects.json"), "utf8"),
  );
  assert.equal(projects.projects.length, 4);
  const selectedDirectory = join(root, "selected clone directory");
  const cloned = await request("/github/clone", "POST", {
    repository: "octocat/app", directory: selectedDirectory,
  });
  assert.equal(cloned.status, 201, JSON.stringify(cloned.data));
  assert.equal(cloned.data.project.path, join(selectedDirectory, "octocat", "app"));
  assert.equal((await request("/github/clone", "POST", {
    repository: "octocat/app", directory: selectedDirectory,
  })).status, 409);
  for (const directory of ["", "relative/path", 42, "/tmp/invalid\0path"])
    assert.equal((await request("/github/clone", "POST", { repository: "octocat/app", directory })).status, 400);
  await request("/github/auth", "DELETE");
  assert.equal(
    (await request("/github/import", "POST", { repository: "octocat/app" })).status,
    401,
  );
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")).integrations.github.credentials, {});

  const login = (await request("/github/device", "POST")).data;
  assert.equal(login.userCode, "ABCD-1234");
  assert.equal((await request("/github/device/poll", "POST", { id: login.id })).data.pending, true);
  assert.equal(tokenPolls, 0, "Never poll GitHub early");
  clock += 5000;
  assert.equal((await request("/github/device/poll", "POST", { id: login.id })).data.pending, true);
  assert.equal(tokenPolls, 1);
  clock += 5000;
  oauthMode = "slow";
  assert.equal((await request("/github/device/poll", "POST", { id: login.id })).data.interval, 10);
  clock += 5000;
  await request("/github/device/poll", "POST", { id: login.id });
  assert.equal(tokenPolls, 2);
  clock += 5000;
  oauthMode = "success";
  assert.equal(
    (await request("/github/device/poll", "POST", { id: login.id })).data.integration.connected,
    true,
  );
  assert.equal(oauthRequests[0].scope, "repo");
  await request("/github/auth", "DELETE");
  const cancelled = (await request("/github/device", "POST")).data;
  await request("/github/auth", "DELETE");
  assert.equal((await request("/github/device/poll", "POST", { id: cancelled.id })).status, 400);
  const expired = (await request("/github/device", "POST")).data;
  clock += 901000;
  assert.equal((await request("/github/device/poll", "POST", { id: expired.id })).status, 400);
  await request("/github", "PUT", { enabled: false, directory, clientId: "client" });
  assert.equal((await request("/github/device", "POST")).status, 400);
  expectedToken = "";
  const publicClone = await request("/github/clone", "POST", {
    repository: "octocat/public", directory: selectedDirectory,
  });
  assert.equal(publicClone.status, 201, JSON.stringify(publicClone.data));
  assert.equal(publicClone.data.project.path, join(selectedDirectory, "octocat", "public"));
  assert.ok(!JSON.stringify(publicClone.data).includes(secret));
  const failedClone = await request("/github/clone", "POST", {
    repository: "octocat/failure", directory: selectedDirectory,
  });
  assert.equal(failedClone.status, 400);
  await assert.rejects(access(join(selectedDirectory, "octocat", "failure")));

});
