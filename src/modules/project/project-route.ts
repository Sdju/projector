import { githubProjectRoute } from "../../../core/modules/github/index.ts";
import { parseProjectRef } from "../../../core/modules/project/index.ts";
/** Route params are already decoded by Vue Router. */
export function projectPathFromParams(value: string | string[] | undefined): string {
  const parts = Array.isArray(value) ? value : (value ?? "").split("/");
  return `/${parts
    .flatMap((part) => part.split("/"))
    .filter(Boolean)
    .join("/")}`;
}

export function githubRepositoryFromParams(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value : [value ?? ""]).join("/");
}

export function projectRoute(path: string): string {
  const ref = parseProjectRef(path);
  if (ref.kind === "github") return githubProjectRoute(ref.repository);
  const segments = path.split("/").filter(Boolean).map(encodeURIComponent);
  return `/projects/${segments.length ? segments.join("/") : "%2F"}`;
}
