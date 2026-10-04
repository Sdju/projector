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

export function projectRefSegments(ref: ProjectRef) {
  const remote = ref.kind === "github";
  const prefix = remote ? GITHUB_PREFIX : "/";
  const parts = (remote ? ref.repository : ref.path).split("/").filter(Boolean);
  return [
    { name: prefix, path: prefix },
    ...parts.map((name, i) => ({ name, path: `${prefix}${parts.slice(0, i + 1).join("/")}` })),
  ];
}
