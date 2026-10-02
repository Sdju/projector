import { isFileDrag, pathsFromDataTransfer } from "../../path-drop/index.ts";

const treeDragType = "application/x-projector-tree-entry";

export function isTerminalFileDrag(data: DataTransfer | null): boolean {
  return isFileDrag(data) || !!data?.types.includes(treeDragType);
}

export function terminalTextForPaths(paths: string[]): string {
  return paths.map((path) => {
    if (!/[\x00-\x1f\x7f]/.test(path)) return "'" + path.replace(/'/g, "'\\''") + "'";
    // Avoid xterm converting newlines into Enter; Bash/Zsh decode these escapes.
    return `$'${path.replace(/[\\'\x00-\x1f\x7f]/g, (char) => {
      if (char === "\\" || char === "'") return `\\${char}`;
      return `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`;
    })}'`;
  }).join(" ") + " ";
}

export async function droppedTerminalPaths(
  data: DataTransfer | null,
  upload: (file: File) => Promise<string>,
  resolveTreePath: (projectId: string, path: string) => Promise<string>,
): Promise<string[]> {
  const treeEntry = data?.getData(treeDragType);
  if (treeEntry) {
    const entry = JSON.parse(treeEntry) as { projectId?: unknown; path?: unknown };
    if (typeof entry.projectId !== "string" || typeof entry.path !== "string" || !entry.path)
      throw new Error("Не удалось прочитать путь файла из дерева");
    return [await resolveTreePath(entry.projectId, entry.path)];
  }
  const paths = pathsFromDataTransfer(data);
  if (paths.length || !data) return paths;
  const files = [...data.files];
  const entries = [...data.items].map((item) => item.webkitGetAsEntry?.());
  if (entries.some((entry) => entry?.isDirectory))
    throw new Error("Браузер не передал путь к папке. Перетащите отдельные файлы.");
  const uploaded: string[] = [];
  for (const file of files) uploaded.push(await upload(file));
  return uploaded;
}
