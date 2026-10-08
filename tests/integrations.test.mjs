import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, readFile, stat, access, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { once } from "node:events";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

// Never touch the real OS keyring from tests.
process.env.PROJECTOR_SECRET_STORE = "file";

test("GitHub integration persists authorization and imports authenticated repositories", async () => {
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
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
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
      expect(init.headers.Authorization).toBe(
        expectedToken ? `Bearer ${expectedToken}` : undefined,
      );
      if (!tokenValid) return Response.json({}, { status: 401 });
      if (address.endsWith("/user")) return Response.json({ login: "octocat" });
      if (address.includes("/user/repos")) {
        const url = new URL(address);
        expect(url.searchParams.get("per_page")).toBe("50");
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
    expect(args.includes("credential.helper=")).toBeTruthy();
    expect(args.includes("core.hooksPath=/dev/null")).toBeTruthy();
    expect(args.includes("http.followRedirects=false")).toBeTruthy();
    expect(!JSON.stringify(args).includes(secret)).toBeTruthy();
    expect(options.env.PROJECTOR_GITHUB_TOKEN).toBe(expectedToken);
    expect(options.env.GIT_TERMINAL_PROMPT).toBe("0");
    void (async () => {
      const helper = await readFile(options.env.GIT_ASKPASS, "utf8");
      expect(helper.includes("PROJECTOR_GITHUB_TOKEN")).toBeTruthy();
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
  onTestFinished(async () => {
    server.close();
    vi.restoreAllMocks();
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
    expect(!JSON.stringify(data).includes(secret), "Public API must not expose token").toBeTruthy();
    expect(!JSON.stringify(data).includes("server-only-code")).toBeTruthy();
    return { status: res.status, data, headers: res.headers };
  }
  expect((await request("")).data.integrations[0].enabled).toBe(false);
  expect((await request("/github/repositories")).status).toBe(400);
  expect(
    (
      await request(
        "/github",
        "PUT",
        { enabled: true, clientId: "client", directory },
        { Origin: "https://foreign.example" },
      )
    ).status,
  ).toBe(403);
  expect(
    (await request("/github", "PUT", { enabled: true, clientId: "client", directory })).status,
  ).toBe(200);
  expect((await request("/github/repositories")).status).toBe(401);
  tokenValid = false;
  expect((await request("/github/auth", "POST", { token: secret })).status).toBe(401);
  expect((await request("")).data.integrations[0].connected).toBe(false);
  tokenValid = true;
  expect((await request("/github/auth", "POST", { token: secret })).data.account).toBe("octocat");
  const file = join(root, "data", "projector", "integrations.json");
  expect(JSON.parse(await readFile(file, "utf8")).integrations.github.credentials.token).toBe(
    secret,
  );
  if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect((await request("")).headers.get("cache-control")).toBe("no-store");
  const reloaded = await import("../server/modules/integration-store/index.ts?reload-check");
  expect((await reloaded.integrationConfig("github")).credentials.login).toBe("octocat");
  expect((await request("/github/repositories?page=0")).status).toBe(400);
  const firstPage = (await request("/github/repositories")).data;
  expect(firstPage.repositories[0].private).toBe(true);
  expect(firstPage.hasMore).toBe(true);
  const secondPage = (await request("/github/repositories?page=2")).data;
  expect(secondPage.page).toBe(2);
  expect(secondPage.hasMore).toBe(false);
  expect(secondPage.repositories).toStrictEqual([]);
  expect(
    (await request("/github/import", "POST", { repository: "octocat/../../escape" })).status,
  ).toBe(400);
  expect(
    (await request("/github/import", "POST", { repository: "https://evil.example/x/y" })).status,
  ).toBe(400);
  expect((await request("/github/import", "POST", { repository: "octocat/missing" })).status).toBe(
    404,
  );
  const imported = await request("/github/import", "POST", {
    repository: "https://github.com/octocat/app.git",
  });
  expect(imported.status, JSON.stringify(imported.data)).toBe(201);
  expect(imported.data.project.path).toBe(join(directory, "app"));
  expect(imported.data.project.commands[0].cmd).toBe("pnpm dev");
  expect((await request("/github/import", "POST", { repository: "octocat/app" })).status).toBe(409);
  expect(clones).toBe(1);
  await mkdir(join(directory, "existing"));
  expect((await request("/github/import", "POST", { repository: "octocat/existing" })).status).toBe(
    409,
  );
  const failure = await request("/github/import", "POST", { repository: "octocat/failure" });
  expect(failure.status).toBe(400);
  await expect(access(join(directory, "failure"))).rejects.toThrow();
  const simultaneous = await Promise.all(
    ["one", "two", "plain"].map((name) =>
      request("/github/import", "POST", { repository: `octocat/${name}` }),
    ),
  );
  for (const result of simultaneous) expect(result.status).toBe(201);
  expect(simultaneous[2].data.project.commands[0].cmd).toBe("git status");
  const projects = JSON.parse(
    await readFile(join(root, "data", "projector", "projects.json"), "utf8"),
  );
  expect(projects.projects.length).toBe(4);
  const selectedDirectory = join(root, "selected clone directory");
  const cloned = await request("/github/clone", "POST", {
    repository: "octocat/app",
    directory: selectedDirectory,
  });
  expect(cloned.status, JSON.stringify(cloned.data)).toBe(201);
  expect(cloned.data.project.path).toBe(join(selectedDirectory, "app"));
  expect(
    (
      await request("/github/clone", "POST", {
        repository: "octocat/app",
        directory: selectedDirectory,
      })
    ).status,
  ).toBe(409);
  for (const directory of ["", "relative/path", 42, "/tmp/invalid\0path"])
    expect(
      (await request("/github/clone", "POST", { repository: "octocat/app", directory })).status,
    ).toBe(400);
  await request("/github/auth", "DELETE");
  expect((await request("/github/import", "POST", { repository: "octocat/app" })).status).toBe(401);
  expect(JSON.parse(await readFile(file, "utf8")).integrations.github.credentials).toStrictEqual(
    {},
  );

  const login = (await request("/github/device", "POST")).data;
  expect(login.userCode).toBe("ABCD-1234");
  expect((await request("/github/device/poll", "POST", { id: login.id })).data.pending).toBe(true);
  expect(tokenPolls, "Never poll GitHub early").toBe(0);
  clock += 5000;
  expect((await request("/github/device/poll", "POST", { id: login.id })).data.pending).toBe(true);
  expect(tokenPolls).toBe(1);
  clock += 5000;
  oauthMode = "slow";
  expect((await request("/github/device/poll", "POST", { id: login.id })).data.interval).toBe(10);
  clock += 5000;
  await request("/github/device/poll", "POST", { id: login.id });
  expect(tokenPolls).toBe(2);
  clock += 5000;
  oauthMode = "success";
  expect(
    (await request("/github/device/poll", "POST", { id: login.id })).data.integration.connected,
  ).toBe(true);
  expect(oauthRequests[0].scope).toBe("repo");
  await request("/github/auth", "DELETE");
  const cancelled = (await request("/github/device", "POST")).data;
  await request("/github/auth", "DELETE");
  expect((await request("/github/device/poll", "POST", { id: cancelled.id })).status).toBe(400);
  const expired = (await request("/github/device", "POST")).data;
  clock += 901000;
  expect((await request("/github/device/poll", "POST", { id: expired.id })).status).toBe(400);
  await request("/github", "PUT", { enabled: false, directory, clientId: "client" });
  expect((await request("/github/device", "POST")).status).toBe(400);
  expectedToken = "";
  const publicClone = await request("/github/clone", "POST", {
    repository: "octocat/public",
    directory: selectedDirectory,
  });
  expect(publicClone.status, JSON.stringify(publicClone.data)).toBe(201);
  expect(publicClone.data.project.path).toBe(join(selectedDirectory, "public"));
  expect(!JSON.stringify(publicClone.data).includes(secret)).toBeTruthy();
  const failedClone = await request("/github/clone", "POST", {
    repository: "octocat/failure",
    directory: selectedDirectory,
  });
  expect(failedClone.status).toBe(400);
  await expect(access(join(selectedDirectory, "failure"))).rejects.toThrow();
  const { os } = await import("../core/modules/os/index.ts");
  const { parseDockerEnvironment, environmentLaunch, environmentForPath, runEnvironmentCommand } =
    await import("../server/modules/environments/index.ts");
  const dockerCalls = [];
  const docker = vi.spyOn(os.tools, "runDocker").mockImplementation(async (args) => {
    dockerCalls.push(args);
    if (args.includes("run") && args.at(-1).startsWith("https://github.com/")) {
      const source = args[args.indexOf("--mount") + 1].match(/source=(.*),target=/)[1];
      await mkdir(join(source, "checkout"));
      await writeFile(join(source, "checkout", "README"), "Docker clone fixture");
      const credentials = args[args.indexOf("--env-file") + 1];
      expect((await stat(credentials)).mode & 0o777).toBe(0o600);
    }
    if (args[0] === "context")
      return {
        stdout: JSON.stringify([
          { Endpoints: { docker: { Host: "unix:///var/run/docker.sock" } } },
        ]),
        stderr: "",
      };
    return { stdout: "", stderr: "" };
  });
  const dockerClone = await request("/github/clone", "POST", {
    repository: "octocat/isolated",
    directory: selectedDirectory,
    environment: { kind: "docker", network: "none" },
  });
  expect(dockerClone.status, JSON.stringify(dockerClone.data)).toBe(201);
  const isolated = dockerClone.data.project;
  expect(isolated.environment.kind).toBe("docker");
  expect(isolated.environment.network).toBe("none");
  expect(dockerCalls.some((args) => args.includes("info"))).toBeTruthy();
  const launch = environmentLaunch(isolated, ["/bin/bash", "-c", "touch /workspace/probe"], false);
  expect(launch.file).toBe("docker");
  for (const flag of [
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    "--pids-limit=256",
    "--memory=2g",
    "--cpus=2",
  ])
    expect(launch.args.includes(flag)).toBeTruthy();
  expect(launch.args[launch.args.indexOf("--network") + 1]).toBe("none");
  expect(launch.args.filter((value) => value === "--mount").length).toBe(1);
  expect(launch.args[launch.args.indexOf("--mount") + 1]).toBe(
    `type=bind,source=${isolated.path},target=/workspace`,
  );
  expect(
    !launch.args.some((value) => value.includes("docker.sock") || value.includes(secret)),
  ).toBeTruthy();
  expect(!launch.args.includes("--privileged")).toBeTruthy();
  expect((await environmentForPath(join(isolated.path, "src"))).id).toBe(isolated.id);
  expect(await environmentForPath(join(isolated.path, "..", "isolated-other"))).toBe(undefined);
  await runEnvironmentCommand(isolated, ["/usr/bin/git", "status"]);
  expect(
    dockerCalls.at(-1).includes("--force"),
    "Docker tool cleanup removes workload, not just CLI",
  ).toBeTruthy();
  const forwarded = environmentLaunch(
    { ...isolated, environment: { ...isolated.environment, network: "bridge", ports: [5173] } },
    ["/bin/bash"],
  );
  expect(forwarded.args.includes("127.0.0.1::5173")).toBeTruthy();
  for (const config of [
    { kind: "docker", privileged: true },
    { kind: "docker", mounts: ["/:/host"] },
    { kind: "docker", network: "host" },
    { kind: "docker", image: "--privileged" },
    { kind: "docker", network: "none", ports: [5173] },
    { kind: "docker", network: "bridge", ports: [0] },
  ])
    expect(() => parseDockerEnvironment(config)).toThrow(expect.objectContaining({ status: 400 }));
  const { normalizeProject } = await import("../server/modules/project-presentation/index.ts");
  const normalized = normalizeProject(
    { ...isolated, path: "/tmp/changed", environment: null },
    isolated,
  );
  expect(normalized.path).toBe(isolated.path);
  expect(normalized.environment).toStrictEqual(isolated.environment);
  const { createTerminalSession } = await import("../server/modules/terminal/index.ts");
  expect(() =>
    createTerminalSession(isolated, { program: "shell" }, undefined, undefined, {
      file: "/bin/bash",
      args: ["-c", "touch /host"],
      title: "Escape",
      docker: { context: "default", kind: "shell" },
    }),
  ).toThrow(expect.objectContaining({ status: 403 }));
  docker.mockRestore();
});
