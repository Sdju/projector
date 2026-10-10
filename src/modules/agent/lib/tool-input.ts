/** Fields the agent usually passes as a short "what" of a call, in the order they are tried. */
const HINT_KEYS = ["command", "query", "path", "file_path", "pattern", "url"] as const;

function parse(raw: string): Record<string, unknown> | undefined {
  try {
    const data = JSON.parse(raw);
    return data && typeof data === "object" && !Array.isArray(data) ? data : undefined;
  } catch {
    return undefined;
  }
}

/** One line telling what a call works on: the command, the path, the query. */
export function inputHint(raw: string): string {
  const data = parse(raw);
  if (!data) return "";
  for (const key of HINT_KEYS) if (typeof data[key] === "string" && data[key]) return data[key];
  return "";
}

const diffLines = (before: unknown, after: unknown) => [
  ...String(before ?? "")
    .split("\n")
    .map((line) => `- ${line}`),
  ...String(after ?? "")
    .split("\n")
    .map((line) => `+ ${line}`),
];

/** Edit calls are shown as a diff: a path, an empty line, then `- `/`+ ` lines. */
export const isEditTool = (name: string) => ["edit", "multiedit"].includes(name.toLowerCase());

const text = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

/**
 * The arguments of a call as text a person can read: the command itself, a path with the file
 * body, an edit as removed/added lines, any other call as `key: value`. Falls back to the raw text.
 */
export function formatToolInput(name: string, raw: string): string {
  const data = parse(raw);
  if (!data) return raw;
  const tool = name.toLowerCase();
  const note = typeof data.description === "string" ? data.description : "";
  if (typeof data.command === "string" && (tool === "bash" || tool === "execute")) {
    return [note && `# ${note}`, `$ ${data.command}`].filter(Boolean).join("\n");
  }
  const path = typeof data.file_path === "string" ? data.file_path : data.path;
  if (typeof path === "string" && typeof data.content === "string")
    return `${path}\n\n${data.content}`;
  if (typeof path === "string" && typeof data.old_string === "string")
    return [path, "", ...diffLines(data.old_string, data.new_string)].join("\n");
  if (typeof path === "string" && Array.isArray(data.edits))
    return [
      path,
      "",
      ...data.edits.flatMap((edit: { old_string?: unknown; new_string?: unknown }, index) => [
        ...(index ? ["@@"] : []),
        ...diffLines(edit.old_string, edit.new_string),
      ]),
    ].join("\n");
  // A plan the agent asks to carry out (`ExitPlanMode`) is its own text.
  if (tool === "exitplanmode" && typeof data.plan === "string") return data.plan;
  const entries = Object.entries(data).filter(([, value]) => value !== undefined && value !== "");
  if (!entries.length) return "";
  return entries
    .map(([key, value]) => {
      const body = text(value);
      return body.includes("\n") ? `${key}:\n${body}` : `${key}: ${body}`;
    })
    .join("\n");
}
