/** What a call does, as the chat shapes its row and body: reading, writing, a command, a search. */
export type ToolVisual = "read" | "write" | "edit" | "bash" | "search" | "web" | "task" | "other";

const KINDS: Record<Exclude<ToolVisual, "other">, readonly string[]> = {
  read: [
    "read",
    "read_file",
    "readfile",
    "read_file_content",
    "readmediafile",
    "read_media_file",
    "view_image",
    "viewimage",
  ],
  write: ["write", "write_file", "writefile", "create_file"],
  edit: ["edit", "multiedit", "edit_file", "apply_patch", "patch"],
  bash: ["bash", "shell", "terminal", "run", "run_command", "execute", "command", "sh"],
  search: ["grep", "glob", "rg", "search", "find", "list_directory", "ls", "list_files"],
  web: ["webfetch", "web_fetch", "websearch", "web_search", "fetch", "fetch_url"],
  task: ["task", "agent", "subagent", "delegate"],
};

const BY_NAME = new Map(
  Object.entries(KINDS).flatMap(([kind, names]) =>
    names.map((name) => [name, kind as ToolVisual] as const),
  ),
);

/** The ACP kind of a call names its action directly, whatever its title says. */
const BY_KIND: Record<string, ToolVisual> = {
  read: "read",
  edit: "edit",
  delete: "write",
  move: "write",
  search: "search",
  execute: "bash",
  fetch: "web",
};

/** A title that names the action when neither the name nor the kind does (Kimi's media read). */
const BY_TITLE: [RegExp, ToolVisual][] = [[/^reading media\b/i, "read"]];

/** The kind of a call by its name; agents disagree on case and separators, the meaning is the same. */
export function toolVisual(name: string, kind?: string): ToolVisual {
  return (
    BY_NAME.get(name.toLowerCase()) ??
    (kind ? BY_KIND[kind] : undefined) ??
    BY_TITLE.find(([pattern]) => pattern.test(name))?.[1] ??
    "other"
  );
}

/** File tools show a path and its content; a command shows its line and live output. */
export const isFileVisual = (visual: ToolVisual) =>
  visual === "read" || visual === "write" || visual === "edit";

/** A path relative to the project, so a row reads `src/app.ts` rather than the whole prefix. */
export function relativePath(path: string, root?: string): string {
  if (!root || !path.startsWith(`${root}/`)) return path;
  return path.slice(root.length + 1);
}

/** Rows a text takes; zero for an empty one, so a row can hide an empty count. */
export const lineCount = (text: string) => (text ? text.split("\n").length : 0);
