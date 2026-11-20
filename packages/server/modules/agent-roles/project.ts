import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import {
  isServiceRoleId,
  normalizeAgentRole,
  type AgentProjectRoleState,
  type AgentRole,
  type AgentRoleView,
} from "@ai-projector/core/modules/agent-role/index.ts";
import {
  createTrustStore,
  projectTrustDescriptor,
  projectWriteTarget,
  readTrustedProjectFile,
  trustStateOf,
  writeTrustedProjectFile,
  type ProjectTrustDescriptor,
  type TrustedProjectFile,
  type TrustedProjectFileSpec,
  type TrustRecord,
} from "../trusted-project-file/index.ts";
import { writeFileAtomic } from "../atomic-files/index.ts";

/** Roles a project keeps in its repository; inert until the user trusts this exact file. */
export const projectRolesRelativeFile = ".projector/roles.json";
export const projectRolesTrustFile = () => join(dataDir(), "agent", "role-trust.json");

interface RoleTrustEntry extends TrustRecord {
  at: string;
}

const rolesTrust = createTrustStore<RoleTrustEntry>({
  file: projectRolesTrustFile,
  fields: ["hash", "at"],
});

const rolesFile = (projectId: string): TrustedProjectFileSpec<AgentRole[], RoleTrustEntry> => ({
  projectId,
  relativeFile: projectRolesRelativeFile,
  trust: rolesTrust,
  parse: rolesOf,
  fallback: [],
  escape: "Файл ролей проекта указывает за его пределы",
  unreadable: "Не удалось прочитать роли проекта",
});

/** Состояние ролей проекта: файл, его хеш и решение пользователя. */
function roleState(projectId: string, file: TrustedProjectFile<AgentRole[]>) {
  const state: AgentProjectRoleState = {
    projectId,
    path: file.root,
    file: file.file,
    exists: file.exists,
    trusted: file.trusted,
    roles: file.value.map((role) => ({ ...role, inherited: false })),
  };
  if (file.hash) state.hash = file.hash;
  if (file.problem) state.problem = file.problem;
  return state;
}

function rolesOf(text: string): AgentRole[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Файл ролей проекта повреждён");
  }
  const roles = (value as { roles?: unknown })?.roles;
  if (!Array.isArray(roles)) throw new Error("В файле ролей проекта нет roles");
  const result: AgentRole[] = [];
  for (const item of roles) {
    const role = normalizeAgentRole(item);
    if (!role || role.kind !== "chat" || isServiceRoleId(role.id)) continue;
    if (result.some((known) => known.id === role.id)) continue;
    result.push(role);
  }
  return result;
}

/** The project's role file and its trust decision; a broken or unsafe file is reported, not used. */
export async function projectRoleState(projectId: string): Promise<AgentProjectRoleState> {
  return roleState(projectId, await readTrustedProjectFile(rolesFile(projectId)));
}

/** Вид доверия к ролям проекта для реестра `project-trust`. */
export const projectRoleTrustDescriptor: ProjectTrustDescriptor = projectTrustDescriptor(
  "roles",
  rolesTrust,
  async (projectId) => trustStateOf(await readTrustedProjectFile(rolesFile(projectId))),
);

function newRoleId(existing: readonly AgentRole[]): string {
  for (;;) {
    const id = `role-${randomBytes(4).toString("hex")}`;
    if (!isServiceRoleId(id) && !existing.some((role) => role.id === id)) return id;
  }
}

async function writeRoles(root: string, roles: AgentRole[]): Promise<void> {
  const file = await projectWriteTarget(
    root,
    projectRolesRelativeFile,
    "Папка .projector указывает за пределы проекта",
  );
  await writeFileAtomic(file, `${JSON.stringify({ version: 1, roles }, null, 2)}\n`, {
    mode: 0o644,
  });
}

async function modify(
  projectId: string,
  action: (roles: AgentRole[]) => AgentRole[],
): Promise<AgentProjectRoleState> {
  const file = await writeTrustedProjectFile({
    ...rolesFile(projectId),
    change: action,
    write: writeRoles,
    // Роли проекта после любой правки требуют нового подтверждения: даже совпавшие байты не
    // должны продлевать доверие незаметно для пользователя.
    afterWrite: "reset",
    record: (hash) => ({ hash, at: new Date().toISOString() }),
  });
  return roleState(projectId, file);
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
    throw new Error("Файлу ролей проекта нельзя доверять");
  await rolesTrust.set(
    state.path,
    trusted ? { hash: state.hash!, at: new Date().toISOString() } : null,
  );
  return projectRoleState(projectId);
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
