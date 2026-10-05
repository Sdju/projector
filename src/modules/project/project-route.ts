import { githubProjectRoute } from "../../../core/modules/github/index.ts";
import { parseProjectRef, pathFromUrlSegments, pathToUrlSegments } from "../../../core/modules/project/index.ts";
/** Route params are already decoded by Vue Router. */
export function projectPathFromParams(value: string | string[] | undefined): string {
  const parts = Array.isArray(value) ? value : (value ?? "").split("/");
  return pathFromUrlSegments(parts);
}

export function githubRepositoryFromParams(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value : [value ?? ""]).join("/");
}

export function projectRoute(path: string): string {
  const ref = parseProjectRef(path);
  if (ref.kind === "github") return githubProjectRoute(ref.repository);
  const segments = pathToUrlSegments(path).map((segment) =>
    encodeURIComponent(segment).replaceAll("%3A", ":"),
  );
  return `/projects/${segments.length ? segments.join("/") : "%2F"}`;
}
