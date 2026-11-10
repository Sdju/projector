import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { dataDir } from "@projector-ai/core/modules/app-paths/index.ts";
import { os } from "@projector-ai/core/modules/os/index.ts";
import {
  isServiceRoleId,
  normalizeAgentRole,
  type AgentProjectRoleState,
  type AgentRole,
  type AgentRoleView,
} from "@projector-ai/core/modules/agent-role/index.ts";
import { loadProjects } from "../projects/index.ts";

/** Roles a project keeps in its repository; inert until the user trusts this exact file. */
export const projectRolesRelativeFile = ".projector/roles.json";
export const projectRolesTrustFile = () => join(dataDir(), "agent", "role-trust.json");

interface TrustFile {
  version: 1;
  projects: Record<string, { hash: string; at: string }>;
}

const hashOf = (text: string) => createHash("sha256").update(text).digest("hex");

async function projectRoot(projectId: string): Promise<string> {
  const project = (await loadProjects()).find((item) => item.id === projectId);
  if (!project) throw new Error("Проект не найден");
  return realpath(project.path);
}

function readTrustFile(text: string): TrustFile {
  try {
    const value = JSON.parse(text) as { projects?: unknown };
    const projects: TrustFile["projects"] = {};
    if (value?.projects && typeof value.projects === "object" && !Array.isArray(value.projects))
      for (const [path, item] of Object.entries(value.projects as Record<string, unknown>)) {
        const row = item as { hash?: unknown; at?: unknown };
        if (typeof row?.hash === "string" && typeof row.at === "string")
          projects[path] = { hash: row.hash, at: row.at };
      }
    return { version: 1, projects };
  } catch {
    return { version: 1, projects: {} };
  }
}

async function readTrust(): Promise<TrustFile> {
  try {
    return readTrustFile(await readFile(projectRolesTrustFile(), "utf8"));
  } catch {
    return { version: 1, projects: {} };
  }
}

let queue: Promise<unknown> = Promise.resolve();

async function writeTrust(file: TrustFile): Promise<void> {
  const path = projectRolesTrustFile();
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, path);
  await os.tools.restrictToOwner(path);
}

/** Rejects a `.projector` folder or roles file that escapes the project through a symlink. */
async function safeProjectFile(root: string, file: string): Promise<string> {
  const real = await realpath(file);
  const rel = relative(root, real);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new Error("Файл ролей проекта указывает за его пределы");
  return real;
}

function rolesOf(text: string): AgentRole[] {
  const value = JSON.parse(text) as { roles?: unknown };
  if (!Array.isArray(value?.roles)) throw new Error("В файле ролей проекта нет roles");
  const roles: AgentRole[] = [];
  for (const item of value.roles) {
    const role = normalizeAgentRole(item);
    if (!role || role.kind !== "chat" || isServiceRoleId(role.id)) continue;
    if (roles.some((known) => known.id === role.id)) continue;
    roles.push(role);
  }
  return roles;
}

/** The project's role file and its trust decision; a broken or unsafe file is reported, not used. */
export async function projectRoleState(projectId: string): Promise<AgentProjectRoleState> {
  const root = await projectRoot(projectId);
  const file = join(root, projectRolesRelativeFile);
  const trust = await readTrust();
  try {
    const raw = await readFile(file, "utf8");
    const real = await safeProjectFile(root, file);
    const hash = hashOf(raw);
    let roles: AgentRole[];
    try {
      roles = rolesOf(raw);
    } catch (error) {
      return {
        projectId,
        path: root,
        file: real,
        exists: true,
        trusted: false,
        hash,
        roles: [],
        problem:
          error instanceof Error && error.message.startsWith("В файле")
            ? error.message
            : "Файл ролей проекта повреждён",
      };
    }
    return {
      projectId,
      path: root,
      file: real,
      exists: true,
      trusted: trust.projects[root]?.hash === hash,
      hash,
      roles: roles.map((role) => ({ ...role, inherited: false })),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return {
        projectId,
        path: root,
        file,
        exists: false,
        trusted: false,
        roles: [],
      };
    return {
      projectId,
      path: root,
      file,
      exists: false,
      trusted: false,
      roles: [],
      problem: error instanceof Error ? error.message : "Не удалось прочитать роли проекта",
    };
  }
}

function projectRolesFile(root: string): string {
  return join(root, projectRolesRelativeFile);
}

function newRoleId(existing: readonly AgentRole[]): string {
  for (;;) {
    const id = `role-${randomBytes(4).toString("hex")}`;
    if (!isServiceRoleId(id) && !existing.some((role) => role.id === id)) return id;
  }
}

async function writeRoles(root: string, roles: AgentRole[]): Promise<void> {
  const file = projectRolesFile(root);
  const directory = dirname(file);
  await mkdir(directory, { recursive: true });
  // `.projector` itself may be a symlink out of the project.
  const realDirectory = await realpath(directory);
  const rel = relative(root, realDirectory);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new Error("Папка .projector указывает за пределы проекта");
  const temporary = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ version: 1, roles }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o644,
  });
  await rename(temporary, file);
}

async function modify(
  projectId: string,
  action: (roles: AgentRole[]) => AgentRole[],
): Promise<AgentProjectRoleState> {
  const task = queue.then(async () => {
    const state = await projectRoleState(projectId);
    if (state.problem) throw new Error(state.problem);
    const roles = state.roles.map(({ inherited: _inherited, ...role }) => role);
    await writeRoles(state.path, action(roles));
    return projectRoleState(projectId);
  });
  queue = task.catch(() => undefined);
  return task;
}

/** Creates a project role; the new file is untrusted until the user approves its hash. */
export async function createProjectRole(
  projectId: string,
  value: unknown,
): Promise<AgentProjectRoleState> {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return modify(projectId, (roles) => {
    const id = newRoleId(roles);
    const role = normalizeAgentRole({ ...(input as object), id, kind: "chat" });
    if (!role || role.kind !== "chat" || isServiceRoleId(role.id))
      throw new Error("Некорректная роль: укажите название и агента");
    return [...roles, role];
  });
}

/** Replaces one project role; the file hash changes, so trust must be granted again. */
export async function saveProjectRole(
  projectId: string,
  id: string,
  value: unknown,
): Promise<AgentProjectRoleState> {
  if (isServiceRoleId(id)) throw new Error("Служебная роль настраивается отдельно");
  return modify(projectId, (roles) => {
    if (!roles.some((role) => role.id === id)) throw new Error(`Неизвестная роль: ${id}`);
    const role = normalizeAgentRole({ ...(value as object), id, kind: "chat" });
    if (!role || role.kind !== "chat")
      throw new Error("Некорректная роль: укажите название и агента");
    return roles.map((item) => (item.id === id ? role : item));
  });
}

export async function deleteProjectRole(
  projectId: string,
  id: string,
): Promise<AgentProjectRoleState> {
  if (isServiceRoleId(id)) throw new Error("Служебную роль нельзя удалить");
  return modify(projectId, (roles) => {
    if (!roles.some((role) => role.id === id)) throw new Error(`Неизвестная роль: ${id}`);
    return roles.filter((role) => role.id !== id);
  });
}

/** Trusts (or stops trusting) the current contents of the project's role file. */
export async function setProjectRoleTrust(
  projectId: string,
  trusted: boolean,
): Promise<AgentProjectRoleState> {
  const state = await projectRoleState(projectId);
  if (trusted && !state.exists) throw new Error("В проекте нет файла ролей");
  if (trusted && (!state.hash || state.problem))
    throw new Error("Файл ролей проекта нельзя доверять");
  const task = queue.then(async () => {
    const file = await readTrust();
    if (trusted) file.projects[state.path] = { hash: state.hash!, at: new Date().toISOString() };
    else delete file.projects[state.path];
    await writeTrust(file);
    return projectRoleState(projectId);
  });
  queue = task.catch(() => undefined);
  return task;
}

/** The role of a trusted project file; untrusted roles never reach chats, jobs or tasks. */
export async function readProjectAgentRole(
  projectId: string,
  id: string,
): Promise<AgentRoleView | undefined> {
  const state = await projectRoleState(projectId);
  if (!state.trusted) return undefined;
  return state.roles.find((role) => role.id === id);
}
