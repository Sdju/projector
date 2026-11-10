import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";

// Never touch the real OS keyring from tests.
process.env.PROJECTOR_SECRET_STORE = "file";

const secret = "glpat-clone-never-return";

async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), "projector-gitlab-clone-"));
  process.env.XDG_DATA_HOME = join(root, "data");
  onTestFinished(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

async function configureGitlab(root, { enabled = true, url, token = secret } = {}) {
  const { updateIntegration } = await import("../modules/integration-store/index.ts");
  await updateIntegration("gitlab", (config) => ({
    ...config,
    enabled,
    settings: { url: url || "https://git.example.com", directory: join(root, "projects") },
    credentials: token ? { token } : {},
  }));
}

function apiFetch(host, projects, requests = []) {
  return async (url, init) => {
    const address = String(url);
    expect(address.startsWith(`${host}/api/v4/`), address).toBe(true);
    expect(init.redirect).toBe("error");
    const path = address.slice(`${host}/api/v4`.length);
    requests.push({ path, headers: init.headers });
    const project = projects[path];
    if (!project) return Response.json({}, { status: 404 });
    return Response.json(project);
  };
}

function cloneProject(path, url) {
  return { path_with_namespace: path, http_url_to_repo: url };
}

function mockGitClone(onClone) {
  const nativeExec = childProcess.execFile;
  childProcess.execFile = (command, args, options, callback) => {
    if (command !== "git") return nativeExec(command, args, options, callback);
    const result = onClone(args, options);
    if (result) return result;
    void (async () => {
      await mkdir(args.at(-1), { recursive: true });
      await writeFile(join(args.at(-1), "README.md"), "fixture");
      callback(null, "", "");
    })().catch(callback);
    return { on() {} };
  };
  syncBuiltinESMExports();
  onTestFinished(() => {
    childProcess.execFile = nativeExec;
    syncBuiltinESMExports();
  });
}

async function waitFor(check) {
  for (let i = 0; i < 200; i++) {
    const value = check();
    if (value) return value;
    await sleep(5);
  }
  throw new Error("condition did not settle");
}

test("gitlabCloneTarget resolves relative, canonical, gl:/ and link forms on allowed hosts", async () => {
  const root = await sandbox();
  await configureGitlab(root);
  const { gitlabCloneTarget } = await import("../modules/gitlab/index.ts");
  const expected = {
    instance: "git.example.com",
    path: "team/tools/app",
    base: "https://git.example.com",
    token: secret,
  };
  for (const input of [
    "team/tools/app",
    "git.example.com/team/tools/app",
    "gl:/git.example.com/team/tools/app",
    "https://git.example.com/team/tools/app/-/tree/main",
  ])
    expect(await gitlabCloneTarget(input), input).toStrictEqual(expected);

  // A token for the configured self-hosted instance never follows a gitlab.com link.
  expect(await gitlabCloneTarget("gitlab.com/team/public")).toStrictEqual({
    instance: "gitlab.com",
    path: "team/public",
    base: "https://gitlab.com",
    token: "",
  });
  for (const input of ["https://evil.example.com/team/app", "gl:/evil.example.com/team/app"])
    await expect(gitlabCloneTarget(input), input).rejects.toMatchObject({ status: 403 });
});

test("a local GitLab clone registers the project and honours the selected folder", async () => {
  const root = await sandbox();
  await configureGitlab(root);
  const host = "https://git.example.com";
  const requests = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(
    apiFetch(
      host,
      {
        [`/projects/${encodeURIComponent("team/tools/app")}`]: cloneProject(
          "team/tools/app",
          `${host}/team/tools/app.git`,
        ),
        [`/projects/${encodeURIComponent("team/tools/other")}`]: cloneProject(
          "team/tools/other",
          `${host}/team/tools/other.git`,
        ),
      },
      requests,
    ),
  );
  const clones = [];
  mockGitClone((args, options) => {
    expect(args.includes("credential.helper=")).toBe(true);
    expect(args.includes("core.hooksPath=/dev/null")).toBe(true);
    expect(args.includes("http.followRedirects=false")).toBe(true);
    expect(!JSON.stringify(args).includes(secret)).toBe(true);
    expect(options.env.PROJECTOR_GITLAB_TOKEN).toBe(secret);
    expect(options.env.GIT_TERMINAL_PROMPT).toBe("0");
    clones.push({ url: args.at(-2), destination: args.at(-1) });
  });
  const { cloneGitlabProject } = await import("../modules/gitlab/index.ts");
  const { loadProjects } = await import("../modules/projects/index.ts");

  const selected = join(root, "selected folder");
  const { project } = await cloneGitlabProject({
    repository: "team/tools/app",
    directory: selected,
  });
  expect(project.path).toBe(join(selected, "team", "tools", "app"));
  expect(clones[0].url).toBe(`${host}/team/tools/app.git`);
  expect(clones[0].destination.startsWith(join(selected, "team", "tools"))).toBe(true);
  expect(clones[0].destination.endsWith("checkout")).toBe(true);
  expect(requests[0].headers["PRIVATE-TOKEN"]).toBe(secret);
  expect((await loadProjects()).some((item) => item.path === project.path)).toBe(true);

  // Without an explicit folder the configured import directory is used.
  const fallback = await cloneGitlabProject({ repository: "team/tools/other" });
  expect(fallback.project.path).toBe(join(root, "projects", "team", "tools", "other"));

  for (const directory of ["", "relative/path", 42, "/tmp/invalid\0path"])
    await expect(
      cloneGitlabProject({ repository: "team/tools/app", directory }),
      String(directory),
    ).rejects.toMatchObject({ status: 400 });
  await expect(
    cloneGitlabProject({ repository: "a/../b", directory: selected }),
  ).rejects.toMatchObject({ status: 400 });
});

test("a public gitlab.com project clones anonymously without PRIVATE-TOKEN", async () => {
  const root = await sandbox();
  await configureGitlab(root, { url: "https://gitlab.com", token: "" });
  const host = "https://gitlab.com";
  const requests = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const address = String(url);
    expect(address.startsWith(`${host}/api/v4/`), address).toBe(true);
    const path = address.slice(`${host}/api/v4`.length);
    requests.push({ path, headers: init.headers });
    expect(init.headers["PRIVATE-TOKEN"]).toBe(undefined);
    if (path === `/projects/${encodeURIComponent("team/public")}`)
      return Response.json(cloneProject("team/public", `${host}/team/public.git`));
    return Response.json({}, { status: 404 });
  });
  mockGitClone((args, options) => {
    expect(options.env.PROJECTOR_GITLAB_TOKEN).toBe("");
    expect(!JSON.stringify(args).includes(secret)).toBe(true);
  });
  const { cloneGitlabProject } = await import("../modules/gitlab/index.ts");
  const { project } = await cloneGitlabProject({ repository: "team/public" });
  expect(project.path).toBe(join(root, "projects", "team", "public"));
  expect(requests[0].headers["PRIVATE-TOKEN"]).toBe(undefined);

  // A disabled self-hosted integration needs configuration before it may clone.
  await configureGitlab(root, { enabled: false, url: "https://git.example.com" });
  await expect(
    cloneGitlabProject({ repository: "team/tools/app", directory: join(root, "disabled") }),
  ).rejects.toMatchObject({ status: 400 });
});

test("a GitLab Docker clone keeps the token in a private env file", async () => {
  const root = await sandbox();
  await configureGitlab(root);
  const host = "https://git.example.com";
  vi.spyOn(globalThis, "fetch").mockImplementation(
    apiFetch(host, {
      [`/projects/${encodeURIComponent("team/tools/app")}`]: cloneProject(
        "team/tools/app",
        `${host}/team/tools/app.git`,
      ),
    }),
  );
  const { os } = await import("../../core/modules/os/index.ts");
  const dockerCalls = [];
  let runArgs;
  let credentialsText = "";
  let credentialsMode = 0;
  vi.spyOn(os.tools, "runDocker").mockImplementation(async (args) => {
    dockerCalls.push(args);
    if (args[0] === "context")
      return {
        stdout: JSON.stringify([
          { Endpoints: { docker: { Host: "unix:///var/run/docker.sock" } } },
        ]),
        stderr: "",
      };
    if (args.includes("image") && args.includes("inspect")) throw new Error("image is missing");
    if (args.includes("run")) {
      runArgs = args;
      const credentials = args[args.indexOf("--env-file") + 1];
      credentialsText = await readFile(credentials, "utf8");
      credentialsMode = (await stat(credentials)).mode & 0o777;
      const source = args[args.indexOf("--mount") + 1].match(/source=(.*),target=/)[1];
      await mkdir(join(source, "checkout"));
      await writeFile(join(source, "checkout", "README.md"), "docker fixture");
    }
    return { stdout: "", stderr: "" };
  });
  const { cloneGitlabProject } = await import("../modules/gitlab/index.ts");
  const phases = [];
  const { project } = await cloneGitlabProject(
    {
      repository: "team/tools/app",
      directory: join(root, "docker"),
      environment: { kind: "docker", network: "none" },
    },
    { phase: (phase) => phases.push(phase) },
  );
  expect(phases).toStrictEqual(["preparing", "pulling", "cloning", "finishing"]);
  expect(project.path).toBe(join(root, "docker", "team", "tools", "app"));
  expect(project.environment.kind).toBe("docker");
  expect(project.environment.network).toBe("none");
  expect(credentialsText).toBe(`PROJECTOR_GITLAB_TOKEN=${secret}\n`);
  if (process.platform !== "win32") expect(credentialsMode).toBe(0o600);
  expect(runArgs).toBeDefined();
  const script = runArgs.find((arg) => arg.includes("cat > /tmp/askpass"));
  expect(script).toBeDefined();
  expect(script.includes("oauth2")).toBe(true);
  expect(script.includes("PROJECTOR_GITLAB_TOKEN")).toBe(true);
  expect(!runArgs.includes(secret)).toBe(true);
  expect(runArgs.at(-1)).toBe(`${host}/team/tools/app.git`);
  expect(runArgs[runArgs.indexOf("--network") + 1]).toBe("bridge");
  expect(dockerCalls.some((args) => args.includes("info"))).toBe(true);
  expect(dockerCalls.some((args) => args.includes("pull"))).toBe(true);
  expect(dockerCalls.some((args) => args.includes("--env-file"))).toBe(true);
});

test("a GitLab clone job reports cloning and stays cancelled", async () => {
  const root = await sandbox();
  await configureGitlab(root);
  const host = "https://git.example.com";
  vi.spyOn(globalThis, "fetch").mockImplementation(
    apiFetch(host, {
      [`/projects/${encodeURIComponent("team/tools/app")}`]: cloneProject(
        "team/tools/app",
        `${host}/team/tools/app.git`,
      ),
    }),
  );
  let cloneOptions;
  const nativeExec = childProcess.execFile;
  // Never finish the git call: the job is cancelled while it is still running.
  childProcess.execFile = (command, args, options, callback) => {
    if (command !== "git") return nativeExec(command, args, options, callback);
    cloneOptions = options;
    options.signal.addEventListener("abort", () => callback(new Error("aborted")), { once: true });
    return { on() {} };
  };
  syncBuiltinESMExports();
  onTestFinished(() => {
    childProcess.execFile = nativeExec;
    syncBuiltinESMExports();
  });
  const { startCloneJob, cloneJob, cancelCloneJob } =
    await import("../modules/git-import/index.ts");
  const { cloneGitlabProject } = await import("../modules/gitlab/index.ts");
  const job = startCloneJob(
    { repository: "team/tools/app", directory: join(root, "jobs") },
    cloneGitlabProject,
  );
  expect(job.phase).toBe("queued");
  await waitFor(() => cloneJob(job.id).phase === "cloning");
  expect(cloneJob(job.id).message).toBe("Клонирую репозиторий");
  await waitFor(() => cloneOptions);
  expect(cloneOptions.env.PROJECTOR_GITLAB_TOKEN).toBe(secret);
  cancelCloneJob(job.id);
  const cancelled = await waitFor(() =>
    ["cancelled", "error"].includes(cloneJob(job.id).phase) ? cloneJob(job.id) : null,
  );
  expect(cancelled.phase).toBe("cancelled");
  expect(cancelled.project).toBe(undefined);
});
