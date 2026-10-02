function decodeFileUri(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const token = trimmed.split("\t")[0]?.trim() ?? "";
  if (token.startsWith("file:")) {
    try {
      const url = new URL(token);
      return decodeURIComponent(url.pathname);
    } catch {
      return decodeURIComponent(token.replace(/^file:\/\/[^/]*/, ""));
    }
  }
  if (token.startsWith("/")) return token.replace(/\/+$/, "") || "/";
  return null;
}

function collectFromText(text: string, into: string[]): void {
  for (const line of text.split(/\r?\n/)) {
    const path = decodeFileUri(line);
    if (path && !into.includes(path)) into.push(path);
  }
}

export function isFileDrag(data: DataTransfer | null): boolean {
  if (!data) return false;
  return data.types.some(
    (type) =>
      type === "Files" ||
      type === "text/uri-list" ||
      type === "text/x-moz-url" ||
      type.includes("uri"),
  );
}

export function pathsFromDataTransfer(data: DataTransfer | null): string[] {
  if (!data) return [];
  const found: string[] = [];
  const types = [...data.types];
  for (const type of types) {
    if (type === "Files") continue;
    const text = data.getData(type);
    if (text) collectFromText(text, found);
  }
  if (!found.length) {
    collectFromText(data.getData("text/uri-list"), found);
    collectFromText(data.getData("text/plain"), found);
  }
  for (const file of data.files) {
    const path = (file as File & { path?: string }).path;
    if (path && !found.includes(path)) found.push(path);
  }
  return found;
}

export function agentMessageForPaths(paths: string[]): string {
  if (paths.length === 1) return `добавь проект ${paths[0]}`;
  return `добавь эти проекты:\n${paths.map((path) => `- ${path}`).join("\n")}`;
}
