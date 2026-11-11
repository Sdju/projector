import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.PROJECTOR_SECRET_STORE = "file";

const repository = "octo/project";
const base = `https://api.github.com/repos/${repository}`;

async function setup(token = "") {
  const root = await mkdtemp(join(tmpdir(), "projector-github-pipelines-"));
  process.env.XDG_DATA_HOME = join(root, "data");
  const { updateIntegration } = await import("../modules/integration-store/index.ts");
  await updateIntegration("github", () => ({
    enabled: true,
    settings: { directory: join(root, "projects") },
    credentials: token ? { token, login: "tester" } : {},
  }));
  onTestFinished(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });
}

function mockFetch(handler) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (address, init) => {
    const url =
      address instanceof URL ? address.href : typeof address === "string" ? address : address.url;
    return handler(url, init);
  });
}

function runRow(overrides = {}) {
  return {
    id: 42,
    name: "CI",
    display_title: "Fix the build",
    path: ".github/workflows/ci.yml",
    run_number: 12,
    run_attempt: 1,
    status: "completed",
    conclusion: "success",
    event: "push",
    head_branch: "main",
    head_sha: "a".repeat(40),
    html_url: "https://github.com/octo/project/actions/runs/42",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:01:00Z",
    run_started_at: "2024-01-01T00:00:10Z",
    actor: { login: "octocat", avatar_url: "https://github.com/o.png" },
    head_commit: { message: "Fix the build\n\nDetails" },
    pull_requests: [{ number: 221 }],
    ...overrides,
  };
}

function jobRow(overrides = {}) {
  return {
    id: 7,
    run_id: 42,
    name: "build",
    status: "completed",
    conclusion: "failure",
    head_branch: "main",
    html_url: "https://github.com/octo/project/actions/runs/42/job/7",
    started_at: "2024-01-01T00:00:10Z",
    completed_at: "2024-01-01T00:01:00Z",
    labels: ["ubuntu-latest"],
    runner_name: "GitHub Actions 1",
    steps: [
      {
        name: "checkout",
        status: "completed",
        conclusion: "success",
        number: 1,
        started_at: "2024-01-01T00:00:10Z",
        completed_at: "2024-01-01T00:00:20Z",
      },
      {
        name: "npm test",
        status: "completed",
        conclusion: "failure",
        number: 2,
        started_at: "2024-01-01T00:00:20Z",
        completed_at: "2024-01-01T00:01:00Z",
      },
    ],
    ...overrides,
  };
}

test("GitHub workflow runs map statuses, fields, filters and pages", async () => {
  await setup();
  const queries = [];
  mockFetch((address, init) => {
    const url = new URL(address);
    expect(url.origin + url.pathname).toBe(`${base}/actions/runs`);
    expect(init.redirect).toBe("error");
    queries.push(Object.fromEntries(url.searchParams));
    return Response.json({
      total_count: 32,
      workflow_runs: [
        runRow(),
        runRow({
          id: 41,
          status: "in_progress",
          conclusion: null,
          event: "pull_request",
          head_branch: "feature",
          actor: null,
        }),
      ],
    });
  });
  const { browseGithubPipelines } = await import("../modules/github/index.ts");
  const list = await browseGithubPipelines(repository);
  expect(queries[0]).toStrictEqual({ per_page: "30", page: "1" });
  expect(list.next).toBe(null);
  expect(list.pipelines[0]).toStrictEqual({
    id: 42,
    name: "CI",
    title: "Fix the build",
    number: 12,
    attempt: 1,
    path: ".github/workflows/ci.yml",
    commitMessage: "Fix the build",
    pulls: [221],
    status: "success",
    source: "push",
    ref: "main",
    sha: "a".repeat(40),
    author: { login: "octocat", avatarUrl: "https://github.com/o.png" },
    webUrl: "https://github.com/octo/project/actions/runs/42",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:01:00Z",
    duration: 50,
  });
  expect(list.pipelines[1].status).toBe("running");
  expect(list.pipelines[1].duration).toBe(null);
  expect(list.pipelines[1].author).toStrictEqual({ login: "", avatarUrl: "" });

  await browseGithubPipelines(repository, { status: "failed", page: "2", ref: "main" });
  expect(queries[1]).toStrictEqual({
    per_page: "30",
    page: "2",
    status: "failure",
    branch: "main",
  });
  await browseGithubPipelines(repository, { status: "all" });
  expect(queries[2].status).toBeUndefined();
  await expect(browseGithubPipelines(repository, { status: "nope" })).rejects.toThrow(
    /Неизвестный статус/,
  );
  await expect(browseGithubPipelines(repository, { page: "0" })).rejects.toThrow(/страница/);
});

test("GitHub workflow runs report the next page and map GitHub conclusions", async () => {
  await setup();
  mockFetch(() =>
    Response.json({
      workflow_runs: Array.from({ length: 30 }, (_, index) =>
        runRow({
          id: 100 + index,
          status: index === 0 ? "completed" : "in_progress",
          conclusion: index === 0 ? "action_required" : null,
        }),
      ),
    }),
  );
  const { browseGithubPipelines } = await import("../modules/github/index.ts");
  const list = await browseGithubPipelines(repository);
  expect(list.next).toBe(2);
  expect(list.pipelines[0].status).toBe("manual");
  expect(list.pipelines[1].status).toBe("running");
});

test("GitHub run detail maps jobs and reports a truncated list", async () => {
  await setup();
  const paths = [];
  mockFetch((address) => {
    const url = new URL(address);
    paths.push(`${url.pathname}?${url.searchParams}`);
    if (url.pathname === `${new URL(base).pathname}/actions/runs/42`)
      return Response.json(runRow());
    if (url.pathname === `${new URL(base).pathname}/actions/runs/42/jobs`) {
      const page = Number(url.searchParams.get("page"));
      if (page === 1)
        return Response.json({
          total_count: 2,
          jobs: [jobRow(), jobRow({ id: 8, status: "queued", conclusion: null, steps: [] })],
        });
      return Response.json({ total_count: 2, jobs: [] });
    }
    return Response.json({}, { status: 404 });
  });
  const { browseGithubPipeline } = await import("../modules/github/index.ts");
  const detail = await browseGithubPipeline(repository, "42");
  expect(detail.pipeline.id).toBe(42);
  expect(detail.pipeline.status).toBe("success");
  expect(detail.jobsTruncated).toBe(false);
  expect(detail.jobs.map((job) => [job.id, job.status, job.stage])).toStrictEqual([
    [7, "failed", ""],
    [8, "queued", ""],
  ]);
  expect(detail.jobs[0]).toStrictEqual({
    id: 7,
    pipelineId: 42,
    name: "build",
    stage: "",
    status: "failed",
    ref: "main",
    webUrl: "https://github.com/octo/project/actions/runs/42/job/7",
    createdAt: "2024-01-01T00:00:10Z",
    startedAt: "2024-01-01T00:00:10Z",
    finishedAt: "2024-01-01T00:01:00Z",
    duration: 50,
    allowFailure: false,
    failureReason: "npm test",
    labels: ["ubuntu-latest"],
    runner: "GitHub Actions 1",
    steps: [
      {
        name: "checkout",
        status: "success",
        number: 1,
        startedAt: "2024-01-01T00:00:10Z",
        finishedAt: "2024-01-01T00:00:20Z",
        duration: 10,
      },
      {
        name: "npm test",
        status: "failed",
        number: 2,
        startedAt: "2024-01-01T00:00:20Z",
        finishedAt: "2024-01-01T00:01:00Z",
        duration: 40,
      },
    ],
  });
  expect(
    paths.some((path) => path.includes("/actions/runs/42/jobs") && path.includes("page=1")),
  ).toBe(true);
  await expect(browseGithubPipeline(repository, 0)).rejects.toThrow(/номер пайплайна/);
});

test("GitHub run detail reads annotations, timing and workflow metadata", async () => {
  await setup();
  const paths = [];
  mockFetch((address) => {
    const url = new URL(address);
    paths.push(url.pathname);
    if (url.pathname === `${new URL(base).pathname}/actions/runs/42`)
      return Response.json(runRow({ run_attempt: 2 }));
    if (url.pathname === `${new URL(base).pathname}/actions/runs/42/jobs`)
      return Response.json({ jobs: [jobRow()] });
    if (url.pathname === `${new URL(base).pathname}/actions/runs/42/timing`)
      return Response.json({
        billable: { UBUNTU: { total_ms: 180000 }, WINDOWS: { total_ms: 0 } },
      });
    if (url.pathname === `${new URL(base).pathname}/check-runs/7/annotations`)
      return Response.json([
        {
          path: "packages/server/tests/usage-logs.test.mjs",
          start_line: 359,
          end_line: 359,
          annotation_level: "failure",
          title: "Tests",
          message: "expected 34661 to be 43771",
        },
        { path: "", start_line: null, annotation_level: "notice", message: "   " },
      ]);
    return Response.json({}, { status: 404 });
  });
  const { browseGithubPipeline } = await import("../modules/github/index.ts");
  const detail = await browseGithubPipeline(repository, 42);
  expect(detail.pipeline).toMatchObject({
    title: "Fix the build",
    number: 12,
    attempt: 2,
    path: ".github/workflows/ci.yml",
    commitMessage: "Fix the build",
    pulls: [221],
  });
  expect(detail.usage).toStrictEqual([{ label: "Ubuntu", milliseconds: 180000 }]);
  expect(detail.annotations).toStrictEqual([
    {
      path: "packages/server/tests/usage-logs.test.mjs",
      startLine: 359,
      endLine: 359,
      level: "failure",
      title: "Tests",
      message: "expected 34661 to be 43771",
    },
  ]);
  expect(detail.annotationsTruncated).toBe(false);
  expect(paths).toContain(`${new URL(base).pathname}/check-runs/7/annotations`);
  expect(paths).toContain(`${new URL(base).pathname}/actions/runs/42/timing`);
});

test("GitHub job detail follows the signed log link and strips ANSI", async () => {
  await setup("secret");
  const requests = [];
  mockFetch((address, init) => {
    requests.push({ address, redirect: init?.redirect });
    if (address === `${base}/actions/jobs/7`)
      return Response.json(jobRow({ run_id: 42, head_branch: "main" }));
    if (address === `${base}/actions/jobs/7/logs`)
      return new Response(null, {
        status: 302,
        headers: { Location: "https://logs.example/run.log" },
      });
    if (address === "https://logs.example/run.log")
      return new Response("\u001b[31mred\u001b[0m\r\nnpm test failed\r\n", {
        headers: { "Content-Type": "text/plain" },
      });
    return Response.json({}, { status: 404 });
  });
  const { browseGithubJob } = await import("../modules/github/index.ts");
  const detail = await browseGithubJob(repository, 7);
  expect(detail.job.id).toBe(7);
  expect(detail.job.failureReason).toBe("npm test");
  expect(detail.job.steps.map((step) => step.name)).toStrictEqual(["checkout", "npm test"]);
  expect(detail.annotations).toStrictEqual([]);
  expect(detail.log).toBe("red\nnpm test failed\n");
  expect(detail.logTruncated).toBe(false);
  expect(requests.find((item) => item.address === `${base}/actions/jobs/7/logs`)).toStrictEqual({
    address: `${base}/actions/jobs/7/logs`,
    redirect: "manual",
  });
  // The token never travels to the storage host.
  expect(requests.find((item) => item.address === "https://logs.example/run.log").redirect).toBe(
    "follow",
  );

  vi.restoreAllMocks();
  mockFetch((address) => {
    if (address === `${base}/actions/jobs/7`) return Response.json(jobRow());
    return Response.json({ message: "410 Gone" }, { status: 410 });
  });
  const expired = await browseGithubJob(repository, 7);
  expect(expired.log).toBe("");
  expect(expired.logTruncated).toBe(false);

  vi.restoreAllMocks();
  mockFetch((address) => {
    if (address === `${base}/actions/jobs/7`) return Response.json(jobRow());
    return Response.json({ message: "404 Not Found" }, { status: 404 });
  });
  const missing = await browseGithubJob(repository, 7);
  expect(missing.log).toBe("");

  await expect(browseGithubJob(repository, "nope")).rejects.toThrow(/номер джоба/);
});
