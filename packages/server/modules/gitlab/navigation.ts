import type {
  DirectoryEntry,
  DirectoryListing,
} from "@projector-ai/core/modules/directories/index.ts";
import { GITLAB_PREFIX } from "@projector-ai/core/modules/gitlab/index.ts";
import { HttpError } from "../http/index.ts";
import { gitlabRequest, gitlabTarget, type GitlabPage, type GitlabTarget } from "./api.ts";

const PAGE_SIZE = 100;
const ENTRY_LIMIT = 100;

interface ApiGroup {
  id: number;
  name?: string;
  path?: string;
  full_path?: string;
}
interface ApiProject {
  name?: string;
  path?: string;
  path_with_namespace?: string;
}
interface ApiUser {
  id: number;
  username?: string;
}

/** Group and project rows before they are turned into `gl:/…` paths. */
interface GroupRow {
  kind: "group";
  value: ApiGroup;
}
interface ProjectRow {
  kind: "project";
  value: ApiProject;
}
type Row = GroupRow | ProjectRow;

function browseParts(path: string): { authority: string; segments: string[] } {
  if (!path.startsWith(GITLAB_PREFIX))
    throw new HttpError(400, "Укажите путь gl:/<instance> или gl:/<instance>/<group>");
  const rest = path.slice(GITLAB_PREFIX.length).replace(/\/+$/, "");
  const [authority = "", ...segments] = rest.split("/");
  if (!authority)
    throw new HttpError(400, "Укажите путь gl:/<instance> или gl:/<instance>/<group>");
  if (
    segments.some(
      (segment) => !segment || segment === "." || segment === ".." || /[\\\0?#]/.test(segment),
    )
  )
    throw new HttpError(400, "Неверный путь группы GitLab");
  return { authority, segments };
}

function hasNext(headers: Headers, page: number, count: number): boolean {
  const raw = headers.get("X-Next-Page");
  if (raw !== null) {
    const next = Number(raw);
    return Number.isInteger(next) && next > page;
  }
  return count === PAGE_SIZE;
}

async function apiRequest<T>(target: GitlabTarget, path: string): Promise<GitlabPage<T>> {
  return gitlabRequest<T>(target.base, path, target.token, { tokenType: target.tokenType });
}

/** Private namespaces are simply absent from hints instead of breaking the whole suggestion list. */
async function hint<T>(run: () => Promise<GitlabPage<T>>): Promise<GitlabPage<T> | null> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) return null;
    throw error;
  }
}

/** Reads pages until the entry limit, reporting whether more rows are available. */
async function collect<T>(
  target: GitlabTarget,
  pathForPage: (page: number) => string,
  limit = ENTRY_LIMIT,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  let page = 1;
  for (;;) {
    const response = await apiRequest<T[]>(target, pathForPage(page));
    const pageRows = Array.isArray(response.data) ? response.data : [];
    for (const row of pageRows) {
      if (rows.length >= limit) return { rows, truncated: true };
      rows.push(row);
    }
    if (!hasNext(response.headers, page, pageRows.length)) return { rows, truncated: false };
    if (rows.length >= limit) return { rows, truncated: true };
    page++;
  }
}

function rowName(row: Row): string {
  const full = rowFullPath(row);
  return row.value.name || full.split("/").pop() || full;
}

function rowFullPath(row: Row): string {
  if (row.kind === "group") return row.value.full_path || row.value.path || String(row.value.id);
  return row.value.path_with_namespace || row.value.path || row.value.name || "";
}

function rowEntry(row: Row, instance: string): DirectoryEntry {
  return {
    name: rowName(row),
    path: `${GITLAB_PREFIX}${instance}/${rowFullPath(row)}`,
  };
}

function sortRows(rows: Row[]): Row[] {
  return [...rows].sort(
    (left, right) =>
      Number(left.kind === "project") - Number(right.kind === "project") ||
      rowName(left).localeCompare(rowName(right), undefined, { sensitivity: "base" }),
  );
}

function filterRows(rows: Row[], fragment: string): Row[] {
  if (!fragment) return rows;
  const prefix = fragment.toLowerCase();
  return rows.filter((row) => {
    if (rowName(row).toLowerCase().startsWith(prefix)) return true;
    const slug = rowFullPath(row).split("/").pop() || "";
    return slug.toLowerCase().startsWith(prefix);
  });
}

function toListing(
  rows: Row[],
  target: GitlabTarget,
  listingPath: string,
  more = false,
): DirectoryListing {
  const sorted = sortRows(rows);
  return {
    path: listingPath,
    entries: sorted.slice(0, ENTRY_LIMIT).map((row) => rowEntry(row, target.instance)),
    truncated: more || sorted.length > ENTRY_LIMIT,
  };
}

async function rootRows(target: GitlabTarget): Promise<{ rows: Row[]; truncated: boolean }> {
  const qualified = target.token ? "membership=true&" : "";
  const [groups, projects] = await Promise.all([
    hint(() =>
      apiRequest<ApiGroup[]>(target, `/groups?${qualified}per_page=${PAGE_SIZE}&order_by=name`),
    ),
    hint(() =>
      apiRequest<ApiProject[]>(
        target,
        `/projects?${qualified}per_page=${PAGE_SIZE}&order_by=last_activity_at`,
      ),
    ),
  ]);
  const rows: Row[] = [
    ...(groups?.data ?? []).map((value) => ({ kind: "group" as const, value })),
    ...(projects?.data ?? []).map((value) => ({ kind: "project" as const, value })),
  ];
  return {
    rows,
    truncated:
      rows.length > ENTRY_LIMIT ||
      (groups !== null && hasNext(groups.headers, 1, groups.data.length)) ||
      (projects !== null && hasNext(projects.headers, 1, projects.data.length)),
  };
}

async function group(parts: string[], target: GitlabTarget): Promise<ApiGroup | null> {
  const name = parts.join("/");
  try {
    return await apiRequest<ApiGroup>(target, `/groups/${encodeURIComponent(name)}`).then(
      (response) => response.data,
    );
  } catch (error) {
    if (error instanceof HttpError && [401, 403, 404].includes(error.status)) return null;
    throw error;
  }
}

async function groupRows(
  value: ApiGroup,
  target: GitlabTarget,
): Promise<{ rows: Row[]; truncated: boolean }> {
  const [subgroups, projects] = await Promise.all([
    collect<ApiGroup>(
      target,
      (page) => `/groups/${value.id}/subgroups?per_page=${PAGE_SIZE}&page=${page}&order_by=name`,
    ),
    collect<ApiProject>(
      target,
      (page) => `/groups/${value.id}/projects?per_page=${PAGE_SIZE}&page=${page}&order_by=name`,
    ),
  ]);
  return {
    rows: [
      ...subgroups.rows.map((row) => ({ kind: "group" as const, value: row })),
      ...projects.rows.map((row) => ({ kind: "project" as const, value: row })),
    ],
    truncated: subgroups.truncated || projects.truncated,
  };
}

async function userRows(
  username: string,
  target: GitlabTarget,
): Promise<{ rows: Row[]; truncated: boolean }> {
  const users = await hint(() =>
    apiRequest<ApiUser[]>(target, `/users?username=${encodeURIComponent(username)}`),
  );
  const user = users?.data.find(
    (candidate) => candidate.username?.toLowerCase() === username.toLowerCase(),
  );
  if (!user) return { rows: [], truncated: false };
  const projects = await collect<ApiProject>(
    target,
    (page) => `/users/${user.id}/projects?per_page=${PAGE_SIZE}&page=${page}`,
  );
  return {
    rows: projects.rows.map((row) => ({ kind: "project", value: row })),
    truncated: projects.truncated,
  };
}

/**
 * Hints for the `gl:/<instance>/<group…>` path bar. The first segment after `gl:/` is the
 * instance authority; the server only reaches gitlab.com or the configured instance.
 */
export async function browseGitlabDirectories(
  path: string,
  complete: boolean,
): Promise<DirectoryListing> {
  const { authority, segments } = browseParts(path);
  // A throwaway repository path lets the allowlist and token rules stay in api.ts.
  const target = await gitlabTarget(`${authority}/x/y`);
  if (!segments.length) {
    const listing = await rootRows(target);
    return toListing(listing.rows, target, `${GITLAB_PREFIX}${target.instance}`, listing.truncated);
  }

  const requested = segments.join("/");
  const groupValue = await group(segments, target);
  if (groupValue) {
    const listing = await groupRows(groupValue, target);
    return toListing(
      listing.rows,
      target,
      `${GITLAB_PREFIX}${target.instance}/${requested}`,
      listing.truncated,
    );
  }
  // A one-segment path may be a personal namespace rather than a group: `gl:/host/username`.
  if (!complete && segments.length === 1) {
    const user = await userRows(segments[0]!, target);
    return toListing(
      user.rows,
      target,
      `${GITLAB_PREFIX}${target.instance}/${requested}`,
      user.truncated,
    );
  }
  if (!complete) throw new HttpError(404, "Группа GitLab не найдена");

  const fragment = segments[segments.length - 1]!;
  const parentSegments = segments.slice(0, -1);
  const parent = parentSegments.length ? await group(parentSegments, target) : null;
  if (!parentSegments.length || parent) {
    const listing = parent ? await groupRows(parent, target) : await rootRows(target);
    const filtered = filterRows(listing.rows, fragment);
    // A one-segment fragment may be a personal namespace instead of a group at the root.
    if (filtered.length || parentSegments.length)
      return toListing(
        filtered,
        target,
        `${GITLAB_PREFIX}${target.instance}/${requested}`,
        listing.truncated,
      );
  }

  const username = segments[0]!;
  const user = await userRows(username, target);
  const filtered = filterRows(user.rows, segments.length > 1 ? fragment : "");
  return toListing(
    filtered,
    target,
    `${GITLAB_PREFIX}${target.instance}/${requested}`,
    user.truncated,
  );
}
