/** Where a project lives. The only place that knows how a reference is spelled as text. */
export type ProjectRef = { kind: "local"; path: string } | { kind: "github"; repository: string };

const GITHUB_PREFIX = "gh:/";
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/;

/** Accepts `owner/repo`, `https://github.com/owner/repo[.git]`; throws on anything else. */
export function normalizeGithubRepository(value: string): string {
  const name = value
    .trim()
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
  if (!REPOSITORY.test(name) || [".", ".."].includes(name.split("/")[1]!))
    throw new Error("Укажите owner/repository");
  return name;
}

export function parseProjectRef(path: string): ProjectRef {
  if (path.startsWith(GITHUB_PREFIX))
    return { kind: "github", repository: path.slice(GITHUB_PREFIX.length) };
  return { kind: "local", path };
}

/** Stable text form: also the project id inside the workspace. */
export function formatProjectRef(ref: ProjectRef): string {
  return ref.kind === "github" ? `${GITHUB_PREFIX}${ref.repository}` : ref.path;
}

const DRIVE = /^[A-Za-z]:$/;
const UNC_SEGMENT = "unc:";

/** Local absolute path: POSIX, a Windows drive, or a UNC share. */
export function isAbsoluteLocalPath(path: string): boolean {
  return path.startsWith("/") || path.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(path);
}

function isWindowsPath(path: string): boolean {
  return path.startsWith("\\\\") || /^[A-Za-z]:(?:[\\/]|$)/.test(path);
}

/**
 * One URL segment per directory. Windows separators become `/`, so
 * `C:\Users\repo` is `C:/Users/repo`. A UNC path starts with the `unc:` segment.
 */
export function pathToUrlSegments(path: string): string[] {
  if (!isWindowsPath(path)) return path === "/" ? [] : path.split("/").filter(Boolean);
  const posix = path.replaceAll("\\", "/");
  if (posix.startsWith("//"))
    return [UNC_SEGMENT, ...posix.slice(2).split("/").filter(Boolean)];
  return posix.split("/").filter(Boolean);
}

/** Inverse of {@link pathToUrlSegments}. Drive and UNC paths use Windows separators. */
export function pathFromUrlSegments(segments: string[]): string {
  const parts = segments.flatMap((part) => part.split("/")).filter(Boolean);
  const legacy =
    parts.length === 1 && parts[0]?.includes("\\") ? parts[0].split("\\").filter(Boolean) : parts;
  const unc = parts[0] === UNC_SEGMENT || (parts.length === 1 && parts[0]?.startsWith("\\\\"));
  if (unc) {
    const rest = parts[0] === UNC_SEGMENT ? parts.slice(1) : legacy;
    return `\\\\${rest.join("\\")}`;
  }
  if (DRIVE.test(legacy[0] ?? "")) {
    const [root, ...rest] = legacy;
    return rest.length ? `${root}\\${rest.join("\\")}` : `${root}\\`;
  }
  return `/${parts.join("/")}`;
}

function localPathSegments(filePath: string) {
  const segments = pathToUrlSegments(filePath);
  if (segments[0] === UNC_SEGMENT) {
    const parts = segments.slice(1);
    return parts.map((name, i) => ({
      name,
      path: `\\\\${parts.slice(0, i + 1).join("\\")}`,
    }));
  }
  if (DRIVE.test(segments[0] ?? "")) {
    const [drive, ...parts] = segments;
    return [
      { name: drive!, path: `${drive}\\` },
      ...parts.map((name, i) => ({
        name,
        path: `${drive}\\${parts.slice(0, i + 1).join("\\")}`,
      })),
    ];
  }
  return [
    { name: "/", path: "/" },
    ...segments.map((name, i) => ({
      name,
      path: `/${segments.slice(0, i + 1).join("/")}`,
    })),
  ];
}

export function projectRefSegments(ref: ProjectRef) {
  if (ref.kind === "github") {
    const parts = ref.repository.split("/").filter(Boolean);
    return [
      { name: GITHUB_PREFIX, path: GITHUB_PREFIX },
      ...parts.map((name, i) => ({
        name,
        path: `${GITHUB_PREFIX}${parts.slice(0, i + 1).join("/")}`,
      })),
    ];
  }
  return localPathSegments(ref.path);
}
