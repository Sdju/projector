import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { createProjectRole, setProjectRoleTrust } from "../modules/agent-roles/index.ts";
import { createProjectPreset, setProjectPresetTrust } from "../modules/agent-presets/index.ts";
import { decideDevcontainer, devcontainerState } from "../modules/devcontainer/index.ts";
import {
  projectAppearanceRelativeFile,
  projectAppearanceState,
  setProjectAppearanceTrust,
} from "../modules/project-appearance/index.ts";
import { auditAllProjectTrust, auditProjectTrust } from "../modules/project-trust/index.ts";
import { loadProjects } from "../modules/projects/index.ts";
import {
  projectWidgetsRelativeFile,
  setProjectWidgetTrust,
} from "../modules/project-widgets/index.ts";
import { readTrustNotices, trustNoticeFile } from "../modules/trust-notices/index.ts";
import { handleApi } from "../app/api.ts";

let directory;
let project;
let previous;

beforeEach(async () => {
  previous = process.env.XDG_DATA_HOME;
  directory = await mkdtemp(join(tmpdir(), "projector-project-trust-"));
  process.env.XDG_DATA_HOME = join(directory, "data");
  project = await realpath(await mkdtemp(join(directory, "project-")));
  await mkdir(join(directory, "data", "projector"), { recursive: true });
  await writeFile(
    join(directory, "data", "projector", "projects.json"),
    JSON.stringify({ projects: [{ id: "p1", name: "Trial", path: project, commands: [] }] }),
  );
  await mkdir(join(project, ".projector"), { recursive: true });
});

afterEach(async () => {
  if (previous === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previous;
  await rm(directory, { recursive: true, maxRetries: 10, retryDelay: 100 });
});

const appearanceFile = () => join(project, projectAppearanceRelativeFile);
const widgetsFile = () => join(project, projectWidgetsRelativeFile);

const widget = {
  name: "ModelMetrics",
  props: { model: { type: "string", description: "имя модели", required: true } },
  template: '<Card :title="model"><Stat label="Скорость" :value="1" /></Card>',
  example: '<ModelMetrics model="gpt-5" />',
};

const kinds = (notices) => notices.map((notice) => notice.kind).sort();

async function trustEverything() {
  await writeFile(appearanceFile(), JSON.stringify({ version: 1, choice: "light" }), "utf8");
  await setProjectAppearanceTrust("p1", true);
  await createProjectRole("p1", {
    name: "Ревьюер",
    agent: "projector",
    selection: { provider: "env:test" },
    prompt: "Проверь diff",
    skills: [],
    mcp: [],
  });
  await setProjectRoleTrust("p1", true);
  await writeFile(widgetsFile(), JSON.stringify({ version: 1, widgets: [widget] }), "utf8");
  await setProjectWidgetTrust("p1", true);
  await createProjectPreset("p1", { title: "Ревью", prompt: "Проверь изменения" });
  await setProjectPresetTrust("p1", true);
}

async function changeEverything() {
  for (const file of [
    appearanceFile(),
    join(project, ".projector", "roles.json"),
    widgetsFile(),
    join(project, ".projector", "presets.json"),
  ])
    await writeFile(file, "\n", { flag: "a" });
}

test("changed project files produce notices and re-trusting one clears only it", async () => {
  await trustEverything();
  await auditProjectTrust("p1");
  expect(await readTrustNotices()).toEqual([]);

  await changeEverything();
  await auditProjectTrust("p1");
  const notices = await readTrustNotices();
  expect(kinds(notices)).toEqual(["appearance", "presets", "roles", "widgets"]);
  for (const notice of notices) {
    expect(notice).toMatchObject({ scope: "project", projectId: "p1", projectPath: project });
    expect(notice.name).toBe("Trial");
    expect(notice.title).toContain("Trial");
  }
  expect(notices.find((notice) => notice.kind === "roles")?.section).toBe("roles");

  await setProjectAppearanceTrust("p1", true);
  await auditProjectTrust("p1");
  expect(kinds(await readTrustNotices())).toEqual(["presets", "roles", "widgets"]);
});

test("the notice action restores trust for the current project file", async () => {
  await trustEverything();
  await changeEverything();
  await auditProjectTrust("p1");
  const notice = (await readTrustNotices()).find((item) => item.kind === "appearance");
  expect(notice).toBeTruthy();

  const server = createServer((req, res) => void handleApi(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${origin}/api/trust-notices`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ id: notice.id }),
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(kinds(data.notices)).toEqual(["presets", "roles", "widgets"]);
    expect((await projectAppearanceState("p1")).trusted).toBe(true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("restoring refuses a file that changed after the notice", async () => {
  await trustEverything();
  await changeEverything();
  await auditProjectTrust("p1");
  const notice = (await readTrustNotices()).find((item) => item.kind === "roles");

  // The notice still describes the previous bytes, so trusting it now would hide an unseen edit.
  await writeFile(join(project, ".projector", "roles.json"), "\n", { flag: "a" });
  const server = createServer((req, res) => void handleApi(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${origin}/api/trust-notices`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ id: notice.id }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/изменился после уведомления/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a scan without notices rebuilds them from stored trust decisions", async () => {
  await trustEverything();
  await changeEverything();
  await rm(trustNoticeFile(), { force: true });

  await auditAllProjectTrust();
  expect(kinds(await readTrustNotices())).toEqual(["appearance", "presets", "roles", "widgets"]);
});

test("a changed trusted devcontainer is a notice too", async () => {
  await mkdir(join(project, ".devcontainer"), { recursive: true });
  const file = join(project, ".devcontainer", "devcontainer.json");
  await writeFile(file, JSON.stringify({ image: "ubuntu" }), "utf8");
  const [item] = await loadProjects();
  const state = devcontainerState(item);
  await decideDevcontainer(item, "trusted", state.hash);

  await auditProjectTrust("p1");
  expect(await readTrustNotices()).toEqual([]);

  await writeFile(file, JSON.stringify({ image: "ubuntu:24.04" }), "utf8");
  await auditProjectTrust("p1");
  const notices = await readTrustNotices();
  expect(kinds(notices)).toEqual(["devcontainer"]);
  expect(notices[0]).not.toHaveProperty("section");

  const server = createServer((req, res) => void handleApi(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${origin}/api/trust-notices`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ id: notices[0].id }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).notices).toEqual([]);
    expect(devcontainerState(item).active).toBe(true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a declined devcontainer never becomes a trust-revoked notice", async () => {
  await mkdir(join(project, ".devcontainer"), { recursive: true });
  const file = join(project, ".devcontainer", "devcontainer.json");
  await writeFile(file, JSON.stringify({ image: "ubuntu" }), "utf8");
  const [item] = await loadProjects();
  const state = devcontainerState(item);
  await decideDevcontainer(item, "declined", state.hash);
  await writeFile(file, JSON.stringify({ image: "ubuntu:24.04" }), "utf8");

  await auditProjectTrust("p1");
  expect(kinds(await readTrustNotices())).toEqual([]);
});
