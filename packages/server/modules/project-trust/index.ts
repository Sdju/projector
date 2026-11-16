import { realpath } from "node:fs/promises";
import { projectRoleTrustDescriptor } from "../agent-roles/index.ts";
import { projectPresetTrustDescriptor } from "../agent-presets/index.ts";
import { devcontainerTrustDescriptor } from "../devcontainer/index.ts";
import { projectAppearanceTrustDescriptor } from "../project-appearance/index.ts";
import { loadProjects } from "../projects/index.ts";
import { projectWidgetTrustDescriptor } from "../project-widgets/index.ts";
import type { ProjectTrustDescriptor } from "../trusted-project-file/index.ts";
import {
  readTrustNotices,
  syncProjectTrustNotices,
  type RevokedProjectFile,
} from "../trust-notices/index.ts";

/**
 * Все виды доверия к файлам проекта. Новый вид достаточно описать своим дескриптором и добавить
 * сюда: проверка одного проекта и полный обход каталога идут по этому же реестру.
 */
const sources: readonly ProjectTrustDescriptor[] = [
  projectAppearanceTrustDescriptor,
  projectRoleTrustDescriptor,
  projectWidgetTrustDescriptor,
  projectPresetTrustDescriptor,
  devcontainerTrustDescriptor,
];

const queues = new Map<string, Promise<void>>();

async function audit(projectId: string): Promise<void> {
  const projects = await loadProjects();
  const project = projects.find((item) => item.id === projectId);
  if (!project) {
    await syncProjectTrustNotices({ id: projectId, name: projectId, path: "" }, []);
    return;
  }
  const found: RevokedProjectFile[] = [];
  for (const source of sources) {
    // Один недоступный или повреждённый файл не должен скрывать остальные решения.
    const state = await source.stateFor(projectId).catch(() => undefined);
    if (state?.revoked && state.hash) found.push({ kind: source.kind, hash: state.hash });
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
  for (const source of sources) for (const root of await source.storedRoots()) roots.add(root);
  if (roots.size) {
    const byRoot = new Map<string, string>();
    for (const project of projects) {
      const root = await realpath(project.path).catch(() => project.path);
      byRoot.set(root, project.id);
    }
    for (const root of roots) {
      const id = byRoot.get(root);
      if (id) targets.add(id);
    }
  }
  for (const id of targets) await auditProjectTrust(id);
}
