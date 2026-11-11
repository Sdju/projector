import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.PROJECTOR_SECRET_STORE = "file";

const repository = "gitlab.com/group/project";
const id = encodeURIComponent("group/project");

async function setup(url = "https://gitlab.com", token = "") {
  const root = await mkdtemp(join(tmpdir(), "projector-gitlab-pipelines-"));
  process.env.XDG_DATA_HOME = join(root, "data");
  const { updateIntegration } = await import("../modules/integration-store/index.ts");
  await updateIntegration("gitlab", () => ({
    enabled: true,
    settings: { url, directory: join(root, "projects") },
    credentials: token ? { token, login: "tester" } : {},
  }));
  onTestFinished(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });
}

function mockFetch(handler) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    expect(init.redirect, "GitLab redirects are forbidden").toBe("error");
    return handler(String(url), init);
  });
}

function pipelineRow(overrides = {}) {
  return {
    id: 42,
    iid: 3,
    status: "success",
    source: "push",
    ref: "main",
    sha: "a".repeat(40),
    name: "deploy",
    web_url: "https://gitlab.com/group/project/-/pipelines/42",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:01:00Z",
    duration: 63,
    user: { username: "tanuki", avatar_url: "https://gitlab.com/a.png" },
    ...overrides,
  };
}

function jobRow(overrides = {}) {
  return {
    id: 7,
    status: "failed",
    stage: "test",
    name: "unit",
    ref: "main",
    web_url: "https://gitlab.com/group/project/-/jobs/7",
    created_at: "2024-01-01T00:00:00Z",
    started_at: "2024-01-01T00:00:10Z",
    finished_at: "2024-01-01T00:01:00Z",
    duration: 50,
    allow_failure: false,
    failure_reason: "script_failure",
    tag_list: ["docker"],
    runner: { description: "shared" },
    pipeline: { id: 42 },
    ...overrides,
  };
}

test("GitLab pipelines map statuses, fields and pages", async () => {
  await setup();
  const queries = [];
  mockFetch((address) => {
    const url = new URL(address);
    expect(url.pathname).toBe(`/api/v4/projects/${id}/pipelines`);
    queries.push(Object.fromEntries(url.searchParams));
    return Response.json(
      [pipelineRow(), pipelineRow({ id: 41, status: "running", duration: null, user: null })],
      { headers: { "X-Next-Page": "2" } },
    );
  });
  const { browseGitlabPipelines } = await import("../modules/gitlab/index.ts");
  const list = await browseGitlabPipelines(repository);
  expect(queries[0]).toStrictEqual({
    per_page: "30",
    page: "1",
    order_by: "id",
    sort: "desc",
  });
  expect(list.next).toBe(2);
  expect(list.pipelines[0]).toStrictEqual({
    id: 42,
    name: "deploy",
    title: "",
    number: 3,
    attempt: 1,
    path: "",
    commitMessage: "",
    pulls: [],
    status: "success",
    source: "push",
    ref: "main",
    sha: "a".repeat(40),
    author: { login: "tanuki", avatarUrl: "https://gitlab.com/a.png" },
    webUrl: "https://gitlab.com/group/project/-/pipelines/42",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:01:00Z",
    duration: 63,
  });
  expect(list.pipelines[1].status).toBe("running");
  expect(list.pipelines[1].duration).toBe(null);
  expect(list.pipelines[1].author).toStrictEqual({ login: "", avatarUrl: "" });

  await browseGitlabPipelines(repository, { status: "failed", page: "2" });
  expect(queries[1]).toStrictEqual({
    per_page: "30",
    page: "2",
    order_by: "id",
    sort: "desc",
    status: "failed",
  });
  await browseGitlabPipelines(repository, { status: "all" });
  expect(queries[2].status).toBeUndefined();
  await expect(browseGitlabPipelines(repository, { status: "nope" })).rejects.toThrow(
    /Неизвестный статус/,
  );
  await expect(browseGitlabPipelines(repository, { page: "0" })).rejects.toThrow(/страница/);
});

test("GitLab pipeline detail maps jobs and reports a truncated list", async () => {
  await setup();
  const paths = [];
  mockFetch((address) => {
    const url = new URL(address);
    paths.push(`${url.pathname}?${url.searchParams}`);
    if (url.pathname === `/api/v4/projects/${id}/pipelines/42`) return Response.json(pipelineRow());
    if (url.pathname === `/api/v4/projects/${id}/pipelines/42/jobs`) {
      if (url.searchParams.get("page") === "1")
        return Response.json(
          [jobRow(), jobRow({ id: 8, status: "skipped", allow_failure: true })],
          {
            headers: { "X-Next-Page": "2" },
          },
        );
      return Response.json([]);
    }
    return Response.json({}, { status: 404 });
  });
  const { browseGitlabPipeline } = await import("../modules/gitlab/index.ts");
  const detail = await browseGitlabPipeline(repository, "42");
  expect(detail.pipeline.id).toBe(42);
  expect(detail.pipeline.status).toBe("success");
  expect(detail.jobsTruncated).toBe(false);
  expect(detail.jobs.map((job) => [job.id, job.status, job.pipelineId])).toStrictEqual([
    [7, "failed", 42],
    [8, "skipped", 42],
  ]);
  expect(detail.jobs[0]).toStrictEqual({
    id: 7,
    pipelineId: 42,
    name: "unit",
    stage: "test",
    status: "failed",
    ref: "main",
    webUrl: "https://gitlab.com/group/project/-/jobs/7",
    createdAt: "2024-01-01T00:00:00Z",
    startedAt: "2024-01-01T00:00:10Z",
    finishedAt: "2024-01-01T00:01:00Z",
    duration: 50,
    allowFailure: false,
    failureReason: "script_failure",
    labels: ["docker"],
    runner: "shared",
    steps: [],
  });
  expect(detail.annotations).toStrictEqual([]);
  expect(detail.usage).toStrictEqual([]);
  expect(paths.some((path) => path.includes("/pipelines/42/jobs") && path.includes("page=2"))).toBe(
    true,
  );
  await expect(browseGitlabPipeline(repository, 0)).rejects.toThrow(/номер пайплайна/);
});

test("GitLab job detail reads a trace, strips ANSI and survives a missing trace", async () => {
  await setup();
  mockFetch((address) => {
    const url = new URL(address);
    if (url.pathname === `/api/v4/projects/${id}/jobs/7`) return Response.json(jobRow());
    if (url.pathname === `/api/v4/projects/${id}/jobs/7/trace`)
      return new Response(
        "\u001b[31mred\u001b[0m\n2026-11-02T22:01:46.918777Z 00O section_start:1:build\r\n2026-11-02T22:01:47.000000Z 00O+ok\n2026-11-02T22:01:48.000000Z 00O section_end:2:build\r\n",
        { headers: { "Content-Type": "text/plain" } },
      );
    return Response.json({}, { status: 404 });
  });
  const { browseGitlabJob } = await import("../modules/gitlab/index.ts");
  const detail = await browseGitlabJob(repository, 7);
  expect(detail.job.id).toBe(7);
  expect(detail.job.failureReason).toBe("script_failure");
  expect(detail.log).toBe("red\n▶ build\nok\n");
  expect(detail.logTruncated).toBe(false);

  vi.restoreAllMocks();
  mockFetch((address) => {
    const url = new URL(address);
    if (url.pathname === `/api/v4/projects/${id}/jobs/7`) return Response.json(jobRow());
    return Response.json({ message: "404 Not Found" }, { status: 404 });
  });
  const missing = await browseGitlabJob(repository, 7);
  expect(missing.log).toBe("");
  expect(missing.logTruncated).toBe(false);

  vi.restoreAllMocks();
  mockFetch((address) => {
    const url = new URL(address);
    if (url.pathname === `/api/v4/projects/${id}/jobs/7`) return Response.json(jobRow());
    // GitLab may hide traces of public projects from anonymous callers.
    return Response.json({ message: "401 Unauthorized" }, { status: 401 });
  });
  const anonymous = await browseGitlabJob(repository, 7);
  expect(anonymous.job.id).toBe(7);
  expect(anonymous.log).toBe("");

  vi.restoreAllMocks();
  mockFetch(() => Response.json({ message: "401 Unauthorized" }, { status: 401 }));
  await expect(browseGitlabJob(repository, 7)).rejects.toThrow(/только после входа/);
  await expect(browseGitlabJob(repository, "nope")).rejects.toThrow(/номер джоба/);
});
