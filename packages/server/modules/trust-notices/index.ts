import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import type {
  ProjectTrustKind,
  TrustNotice,
} from "@ai-projector/core/modules/trust-notices/index.ts";
import { writeFileAtomic, withFileLock } from "../atomic-files/index.ts";
import { broadcastEvent } from "../events/index.ts";

const MAX_NOTICES = 50;

const PROJECT_FILES: Record<ProjectTrustKind, { label: string; file: string; section?: string }> = {
  appearance: {
    label: "Оформление",
    file: ".projector/appearance.json",
    section: "appearance",
  },
  roles: { label: "Роли", file: ".projector/roles.json", section: "roles" },
  widgets: { label: "Виджеты", file: ".projector/widgets.json", section: "widgets" },
  presets: { label: "Пресеты", file: ".projector/presets.json", section: "presets" },
  devcontainer: { label: "Dev Container", file: "devcontainer.json" },
};

export function trustNoticeFile(): string {
  return join(dataDir(), "trust-notices.json");
}

export interface RevokedPlugin {
  plugin: string;
  name: string;
  /** The plugin brings agents; the notice then also mentions limits and analytics. */
  agents: boolean;
  hash?: string;
}

export interface RevokedProjectFile {
  kind: ProjectTrustKind;
  hash?: string;
}

export interface ProjectTrustTarget {
  id: string;
  name: string;
  path: string;
}

function validNotice(value: unknown): value is TrustNotice {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const notice = value as Record<string, unknown>;
  if (notice.scope !== "plugin" && notice.scope !== "project") return false;
  return (
    typeof notice.id === "string" &&
    typeof notice.kind === "string" &&
    typeof notice.name === "string" &&
    typeof notice.title === "string" &&
    typeof notice.body === "string" &&
    typeof notice.createdAt === "number"
  );
}

export async function readTrustNotices(): Promise<TrustNotice[]> {
  try {
    const content = await readFile(trustNoticeFile(), "utf8");
    if (content.length > 200_000) return [];
    const value = JSON.parse(content) as { notices?: unknown };
    if (!Array.isArray(value.notices)) return [];
    return value.notices.filter(validNotice).slice(0, MAX_NOTICES);
  } catch {
    return [];
  }
}

async function writeTrustNotices(notices: readonly TrustNotice[]): Promise<void> {
  await writeFileAtomic(trustNoticeFile(), `${JSON.stringify({ notices }, null, 2)}\n`);
}

function sameNotices(left: readonly TrustNotice[], right: readonly TrustNotice[]): boolean {
  return (
    left.length === right.length &&
    left.every((notice, index) => {
      const other = right[index];
      return other && JSON.stringify(notice) === JSON.stringify(other);
    })
  );
}

function ordered(notices: readonly TrustNotice[]): TrustNotice[] {
  return [...notices]
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .slice(0, MAX_NOTICES);
}

/**
 * One pass that reads the previous list, replaces matching notices and broadcasts a real change.
 * Discovery, a project audit and an inbox request may overlap, so writes go one at a time.
 */
function updateNotices(
  compute: (previous: TrustNotice[]) => TrustNotice[],
): Promise<TrustNotice[]> {
  return withFileLock(trustNoticeFile(), async () => {
    const previous = await readTrustNotices();
    const next = ordered(compute(previous));
    if (sameNotices(previous, next)) return previous;
    await writeTrustNotices(next);
    broadcastEvent("trust-notices-changed", { at: Date.now() });
    return next;
  });
}

function pluginNotice(revoked: RevokedPlugin, previous: TrustNotice | undefined): TrustNotice {
  return {
    id: `plugin-trust:${revoked.plugin}`,
    scope: "plugin",
    kind: "plugin",
    plugin: revoked.plugin,
    name: revoked.name,
    title: `Доверие к плагину «${revoked.name}» отозвано`,
    body: revoked.agents
      ? "Файлы плагина изменились, поэтому его агенты, лимиты и аналитика отключены. Подтвердите доверие заново в настройках плагинов."
      : "Файлы плагина изменились, поэтому его код отключён. Подтвердите доверие заново в настройках плагинов.",
    href: "/settings?section=plugins",
    hash: revoked.hash,
    createdAt: previous?.createdAt ?? Date.now(),
  };
}

function projectNotice(
  project: ProjectTrustTarget,
  kind: ProjectTrustKind,
  hash: string | undefined,
  previous: TrustNotice | undefined,
): TrustNotice {
  const file = PROJECT_FILES[kind];
  return {
    id: `project-trust:${project.id}:${kind}`,
    scope: "project",
    kind,
    projectId: project.id,
    projectPath: project.path,
    ...(file.section ? { section: file.section } : {}),
    ...(hash ? { hash } : {}),
    name: project.name,
    title: `Доверие к настройке «${file.label}» проекта «${project.name}» отозвано`,
    body: `Файл ${file.file} изменился, поэтому прежнее подтверждение больше не действует. Откройте проект и подтвердите доверие заново.`,
    createdAt: previous?.createdAt ?? Date.now(),
  };
}

/** Replaces plugin notices; project notices of the same store stay untouched. */
export function syncPluginTrustNotices(revoked: readonly RevokedPlugin[]): Promise<TrustNotice[]> {
  return updateNotices((previous) => {
    const old = new Map(previous.map((notice) => [notice.id, notice]));
    return [
      ...previous.filter((notice) => notice.scope !== "plugin"),
      ...revoked.map((entry) => pluginNotice(entry, old.get(`plugin-trust:${entry.plugin}`))),
    ];
  });
}

/** Replaces every notice of one project while preserving plugins and other projects. */
export function syncProjectTrustNotices(
  project: ProjectTrustTarget,
  revoked: readonly RevokedProjectFile[],
): Promise<TrustNotice[]> {
  return updateNotices((previous) => {
    const old = new Map(previous.map((notice) => [notice.id, notice]));
    const kept = previous.filter(
      (notice) => notice.scope !== "project" || notice.projectId !== project.id,
    );
    return [
      ...kept,
      ...revoked.map((entry) =>
        projectNotice(
          project,
          entry.kind,
          entry.hash,
          old.get(`project-trust:${project.id}:${entry.kind}`),
        ),
      ),
    ];
  });
}
