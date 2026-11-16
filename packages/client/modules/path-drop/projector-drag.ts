/**
 * Записи Projector, которые перетаскивают внутри окна: дерево файлов, изменения и история
 * Git отдают один формат, а вкладки, терминал и чат читают его одинаково.
 */
export const projectorDragType = "application/x-projector-tree-entry";

export interface ProjectorDragEntry {
  projectId: string;
  path: string;
  /** Выбранные записи: у одиночной строки — она сама. */
  paths: string[];
  /** Источник изменения: diff индекса (`true`) или рабочей копии (`false`). */
  staged?: boolean;
  /** Коммит истории: вкладка открывается как diff этого коммита. */
  commit?: string;
}

/** Кладёт запись во внутренний drag; вызывать синхронно из `dragstart`. */
export function setProjectorDrag(data: DataTransfer, entry: ProjectorDragEntry): void {
  data.setData(projectorDragType, JSON.stringify(entry));
}

export function isProjectorDrag(data: DataTransfer | null): boolean {
  return !!data?.types.includes(projectorDragType);
}

/** Читает внутренний drag; чужой или битый формат не считается записью проекта. */
export function readProjectorDrag(data: DataTransfer | null): ProjectorDragEntry | undefined {
  const raw = data?.getData(projectorDragType);
  if (!raw) return;
  try {
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const { projectId, path, paths, staged, commit } = value;
    if (typeof projectId !== "string" || !projectId) return;
    if (typeof path !== "string" || !path) return;
    const selected = Array.isArray(paths)
      ? paths.filter((item): item is string => typeof item === "string" && !!item)
      : [];
    return {
      projectId,
      path,
      paths: selected.length ? selected : [path],
      ...(typeof staged === "boolean" ? { staged } : {}),
      ...(typeof commit === "string" && commit ? { commit } : {}),
    };
  } catch {
    return;
  }
}
