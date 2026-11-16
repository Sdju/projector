/** Internal folder that keeps deleted project entries recoverable. */
export const TRASH_DIR = ".projector-trash";
/** Bookkeeping folder inside the trash; it is not an entry itself. */
export const TRASH_META_DIR = ".projector-meta";

/** A file or folder moved aside by the workspace instead of being erased. */
export interface TrashEntry {
  /** File name inside `.projector-trash`: the stable identifier of the entry. */
  id: string;
  /** Project-relative path the entry had before deletion. */
  path: string;
  name: string;
  directory: boolean;
  /** ISO 8601 deletion time; the entry's change time when no record was kept. */
  deletedAt: string;
  /** Bytes of a file; `null` for folders, whose size is not counted on every listing. */
  size: number | null;
}

export interface TrashList {
  entries: TrashEntry[];
}

/** A folder or file inside a trashed entry: an expandable level of the trash tree. */
export interface TrashNode {
  /** Path inside the trash: `<entry id>` or `<entry id>/<relative path>`. */
  key: string;
  name: string;
  directory: boolean;
  /** File size; a folder's recursive size comes from `TrashSizes`. */
  size: number | null;
}

export interface TrashDirectory {
  /** Requested node; empty for the trash root. */
  path: string;
  entries: TrashNode[];
  /** The folder has more direct children than one response returns. */
  truncated: boolean;
}

/** Recursive size of one trash node. */
export interface TrashSize {
  key: string;
  /** Bytes of files and symlinks; `null` when the scan did not reach the node. */
  size: number | null;
  files: number;
  /** The time or entry limit stopped the scan: `size` is a lower bound. */
  truncated: boolean;
}

export interface TrashSizes {
  /** Folder whose direct children were measured; empty for the trash root. */
  path: string;
  sizes: TrashSize[];
  /** At least one node was not measured completely. */
  truncated: boolean;
}

export interface TrashRestore {
  id: string;
  /** Project-relative path the entry got back; a taken name becomes `name (2).ext`. */
  path: string;
}

export interface TrashMutation extends TrashList {
  restored: TrashRestore[];
}

/** Name stored after the UUID prefix, used for entries written before metadata existed. */
export function trashEntryName(id: string) {
  return id.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, "");
}

/** `name (2).ext`, `name (3).ext`… for a restore that must not overwrite a file. */
export function restoredName(name: string, index: number) {
  const dot = name.lastIndexOf(".");
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  return `${stem} (${index})${extension}`;
}
