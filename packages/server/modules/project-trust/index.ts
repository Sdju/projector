import { readFile, realpath } from "node:fs/promises";
import type { Project } from "@ai-projector/core/modules/project/index.ts";
import { projectRoleState, projectRolesTrustFile } from "../agent-roles/index.ts";
import { projectPresetState, projectPresetsTrustFile } from "../agent-presets/index.ts";
import { devcontainerState, devcontainerTrustFile } from "../devcontainer/index.ts";
import { projectAppearanceState, projectAppearanceTrustFile } from "../project-appearance/index.ts";
import { loadProjects } from "../projects/index.ts";
import { projectWidgetState, projectWidgetsTrustFile } from "../project-widgets/index.ts";
import {
  readTrustNotices,
  syncProjectTrustNotices,
  type RevokedProjectFile,
} from "../trust-notices/index.ts";

interface HashEntry {
  hash: string;
  decision?: string;
}

type ProjectState = { exists: boolean; trusted: boolean; hash?: string };

const queues = new Map<string, Promise<void>>();

async function readEntries(file: string): Promise<Record<string, HashEntry>> {
  try {
    const value = JSON.parse(await readFile(file, "utf8")) as { projects?: unknown };
    if (!value.projects || typeof value.projects !== "object" || Array.isArray(value.projects))
      return {};
    const entries: Record<string, HashEntry> = {};
    for (const [root, item] of Object.entries(value.projects as Record<string, unknown>)) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const row = item as { hash?: unknown; decision?: unknown };
      if (typeof row.hash !== "string") continue;
      entries[root] =
        typeof row.decision === "string"
          ? { hash: row.hash, decision: row.decision }
          : { hash: row.hash };
    }
    return entries;
  } catch {
    return {};
  }
}

/** The stored confirmation describes different bytes than the file on disk. */
function revoked(entry: HashEntry | undefined, state: ProjectState | undefined): boolean {
  return !!entry && !!state?.exists && !state.trusted && !!state.hash && entry.hash !== state.hash;
}

async function revokedHash(
  entry: HashEntry | undefined,
  read: () => Promise<ProjectState>,
): Promise<string | undefined> {
  if (!entry) return undefined;
  try {
    const state = await read();
    return revoked(entry, state) ? state.hash : undefined;
  } catch {
    return undefined;
  }
}

async function audit(projectId: string): Promise<void> {
  const projects = await loadProjects();
  const project = projects.find((item) => item.id === projectId);
  if (!project) {
    await syncProjectTrustNotices({ id: projectId, name: projectId, path: "" }, []);
    return;
  }
  const root = await realpath(project.path).catch(() => project.path);
  const [appearance, roles, widgets, presets, devcontainer] = await Promise.all([
    readEntries(projectAppearanceTrustFile()),
    readEntries(projectRolesTrustFile()),
    readEntries(projectWidgetsTrustFile()),
    readEntries(projectPresetsTrustFile()),
    readEntries(devcontainerTrustFile()),
  ]);
  const found: RevokedProjectFile[] = [];
  const appearanceHash = await revokedHash(appearance[root], () =>
    projectAppearanceState(projectId),
  );
  if (appearanceHash) found.push({ kind: "appearance", hash: appearanceHash });
  const rolesHash = await revokedHash(roles[root], () => projectRoleState(projectId));
  if (rolesHash) found.push({ kind: "roles", hash: rolesHash });
  const widgetsHash = await revokedHash(widgets[root], () => projectWidgetState(projectId));
  if (widgetsHash) found.push({ kind: "widgets", hash: widgetsHash });
  const presetsHash = await revokedHash(presets[root], () => projectPresetState(projectId));
  if (presetsHash) found.push({ kind: "presets", hash: presetsHash });
  // A declined or absent devcontainer decision has no trust to revoke.
  const devEntry = devcontainer[root];
  if (devEntry?.decision === "trusted") {
    try {
      const state = devcontainerState(project);
      if (state.found && state.hash && devEntry.hash !== state.hash)
        found.push({ kind: "devcontainer", hash: state.hash });
    } catch {
      // A broken config keeps its last notice until the project file is readable again.
    }
  }
  await syncProjectTrustNotices({ id: project.id, name: project.name, path: project.path }, found);
}

/** Re-reads one project's trusted files after an edit or a trust action. */
export function auditProjectTrust(projectId: string): Promise<void> {
  const previous = queues.get(projectId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => audit(projectId))
    .catch((error: unknown) =>
      console.error(
        "Доверие проекта:",
        error instanceof Error ? error.message : "не удалось проверить файлы",
      ),
    );
  queues.set(projectId, next);
  void next.finally(() => {
    if (queues.get(projectId) === next) queues.delete(projectId);
  });
  return next;
}

/**
 * Scans every project that either has a stored trust decision or already shows a notice. A project
 * that was never trusted has nothing to revoke, so its files are not read.
 */
export async function auditAllProjectTrust(): Promise<void> {
  const [projects, notices] = await Promise.all([loadProjects(), readTrustNotices()]);
  const targets = new Set<string>();
  for (const notice of notices)
    if (notice.scope === "project" && notice.projectId) targets.add(notice.projectId);
  const roots = new Set<string>();
  for (const file of [
    projectAppearanceTrustFile(),
    projectRolesTrustFile(),
    projectWidgetsTrustFile(),
    projectPresetsTrustFile(),
    devcontainerTrustFile(),
  ])
    for (const root of Object.keys(await readEntries(file))) roots.add(root);
  if (roots.size) {
    const byRoot = new Map<string, Project>();
    for (const project of projects) {
      const root = await realpath(project.path).catch(() => project.path);
      byRoot.set(root, project);
    }
    for (const root of roots) {
      const project = byRoot.get(root);
      if (project) targets.add(project.id);
    }
  }
  for (const id of targets) await auditProjectTrust(id);
}
