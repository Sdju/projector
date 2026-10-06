/** VS Code–style `files.exclude`: glob pattern → enabled. */
export type FilesExcludeMap = Record<string, boolean>;

/** Internal trash stays hidden and is not editable in settings. */
export const ALWAYS_FILES_EXCLUDE = ["**/.projector-trash", "**/.projector-trash/**"] as const;

/** Defaults use recursive globs so nested copies stay hidden. */
export const DEFAULT_FILES_EXCLUDE = [
  "**/.git",
  "**/node_modules",
  "**/dist",
  "**/build",
  "**/.next",
  "**/.nuxt",
  "**/.output",
  "**/coverage",
  "**/.cache",
  "**/.venv",
  "**/vendor",
] as const;

const always = new Set<string>(ALWAYS_FILES_EXCLUDE);

export function defaultFilesExclude(): FilesExcludeMap {
  return Object.fromEntries(DEFAULT_FILES_EXCLUDE.map((pattern) => [pattern, true]));
}

export function isValidExcludePattern(pattern: string): boolean {
  if (!pattern || pattern.includes("\0") || pattern !== pattern.trim()) return false;
  const normalized = pattern.replaceAll("\\", "/");
  if (normalized.split("/").some((part) => part === "." || part === "..")) return false;
  if (always.has(normalized) || always.has(migratePattern(normalized))) return false;
  return true;
}

/** Bare names from the first settings shape become recursive globs. */
export function migratePattern(pattern: string): string {
  const value = pattern.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (!value || /[*?[{]/.test(value) || value.includes("/")) return value;
  return `**/${value}`;
}

export function normalizeFilesExclude(input: unknown): FilesExcludeMap {
  if (!input || typeof input !== "object" || Array.isArray(input)) return defaultFilesExclude();
  const next: FilesExcludeMap = {};
  for (const [raw, enabled] of Object.entries(input as Record<string, unknown>)) {
    const pattern = migratePattern(raw.trim());
    if (!isValidExcludePattern(pattern) || typeof enabled !== "boolean") continue;
    next[pattern] = enabled;
  }
  return Object.keys(next).length ? next : defaultFilesExclude();
}

export function activeExcludePatterns(map: FilesExcludeMap): string[] {
  const patterns: string[] = [...ALWAYS_FILES_EXCLUDE];
  for (const [pattern, enabled] of Object.entries(map)) {
    if (enabled && isValidExcludePattern(pattern)) patterns.push(pattern);
  }
  return patterns;
}

function globToRegExp(glob: string): RegExp {
  let i = 0;
  let out = "^";
  while (i < glob.length) {
    const char = glob[i]!;
    if (char === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 3;
        } else {
          out += ".*";
          i += 2;
        }
      } else {
        out += "[^/]*";
        i += 1;
      }
      continue;
    }
    if (char === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }
    if ("+.^${}()|[]\\".includes(char)) out += `\\${char}`;
    else out += char;
    i += 1;
  }
  return new RegExp(`${out}$`);
}

/** Match a project-relative POSIX path against one glob (VS Code–like). */
export function matchGlob(path: string, pattern: string): boolean {
  const input = path.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
  let glob = pattern.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (glob.endsWith("/")) glob = glob.slice(0, -1);
  if (!input || !glob) return false;
  return globToRegExp(glob).test(input);
}

/** True when the path or any of its parents matches an active exclude pattern. */
export function isExcludedPath(path: string, patterns: readonly string[]): boolean {
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
  if (!parts.length) return false;
  if (parts.some((part) => part === "." || part === "..")) return true;
  for (let end = 1; end <= parts.length; end++) {
    const prefix = parts.slice(0, end).join("/");
    if (patterns.some((pattern) => matchGlob(prefix, pattern))) return true;
  }
  return false;
}
