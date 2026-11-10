import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import {
  createProjectRole,
  deleteProjectRole,
  projectRoleState,
  projectRolesRelativeFile,
  projectRolesTrustFile,
  readProjectAgentRole,
  saveProjectRole,
  setProjectRoleTrust,
} from "../modules/agent-roles/index.ts";

let directory;
let project;
let previous;

beforeEach(async () => {
  previous = process.env.XDG_DATA_HOME;
  directory = await mkdtemp(join(tmpdir(), "projector-project-roles-"));
  process.env.XDG_DATA_HOME = join(directory, "data");
  project = await realpath(await mkdtemp(join(directory, "project-")));
  await mkdir(join(directory, "data", "projector"), { recursive: true });
  await writeFile(
    join(directory, "data", "projector", "projects.json"),
    JSON.stringify({ projects: [{ id: "p1", name: "Project", path: project, commands: [] }] }),
  );
});

afterEach(async () => {
  if (previous === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previous;
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("project roles are inert until their file is trusted", async () => {
  const created = await createProjectRole("p1", {
    name: "Ревьюер проекта",
    agent: "projector",
    selection: { provider: "env:test" },
    prompt: "Сверяйся с AGENTS.md.",
    skills: ["review"],
    mcp: [],
  });
  expect(created).toMatchObject({
    projectId: "p1",
    exists: true,
    trusted: false,
  });
  expect(created.roles).toHaveLength(1);
  const role = created.roles[0];
  expect(role).toMatchObject({
    kind: "chat",
    name: "Ревьюер проекта",
    prompt: "Сверяйся с AGENTS.md.",
    skills: ["review"],
    mcp: [],
  });
  expect(await readProjectAgentRole("p1", role.id)).toBeUndefined();

  const trusted = await setProjectRoleTrust("p1", true);
  expect(trusted.trusted).toBe(true);
  expect(await readProjectAgentRole("p1", role.id)).toMatchObject({
    name: "Ревьюер проекта",
    prompt: "Сверяйся с AGENTS.md.",
    skills: ["review"],
    mcp: [],
  });

  const updated = await saveProjectRole("p1", role.id, {
    name: "Старший ревьюер",
    agent: "projector",
    selection: { provider: "env:other" },
  });
  expect(updated.trusted).toBe(false);
  expect(await readProjectAgentRole("p1", role.id)).toBeUndefined();
  expect((await setProjectRoleTrust("p1", true)).trusted).toBe(true);
  expect(await readProjectAgentRole("p1", role.id)).toMatchObject({
    name: "Старший ревьюер",
  });

  await deleteProjectRole("p1", role.id);
  expect((await projectRoleState("p1")).roles).toEqual([]);
});

test("a broken or escaping role file is reported and cannot be trusted", async () => {
  const file = join(project, projectRolesRelativeFile);
  await mkdir(join(project, ".projector"), { recursive: true });
  await writeFile(file, "{ broken", "utf8");
  const broken = await projectRoleState("p1");
  expect(broken.trusted).toBe(false);
  expect(broken.problem).toContain("поврежд");
  await expect(setProjectRoleTrust("p1", true)).rejects.toThrow("нельзя доверять");

  await writeFile(file, JSON.stringify({ version: 1, roles: [] }), "utf8");
  const outside = join(directory, "outside-roles.json");
  await writeFile(outside, JSON.stringify({ version: 1, roles: [] }), "utf8");
  await rm(file);
  await symlink(outside, file);
  const escaped = await projectRoleState("p1");
  expect(escaped.trusted).toBe(false);
  expect(escaped.problem).toContain("за его пределы");
});

test("trust is bound to the file hash and the trust file is private", async () => {
  await createProjectRole("p1", {
    name: "Роль",
    agent: "projector",
    selection: {},
  });
  await setProjectRoleTrust("p1", true);
  const file = join(project, projectRolesRelativeFile);
  const before = await readFile(file, "utf8");
  expect(before).toContain("Роль");

  await writeFile(file, JSON.stringify({ version: 1, roles: [] }), "utf8");
  expect((await projectRoleState("p1")).trusted).toBe(false);
  const trust = JSON.parse(await readFile(projectRolesTrustFile(), "utf8"));
  expect(trust.projects[await realpath(project)]).toMatchObject({ hash: expect.any(String) });
});
