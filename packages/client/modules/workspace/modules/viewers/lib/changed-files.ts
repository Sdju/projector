import type { CommitComparison } from "@ai-projector/core/modules/workspace/index.ts";
import type { ResolvedFileIcon } from "@ai-projector/core/modules/file-icons/index.ts";

/** One row of a changed-files list, independent of the host that produced it. */
export interface ChangedFileItem {
  path: string;
  name: string;
  directory: string;
  icon: ResolvedFileIcon;
  previousPath?: string;
  /** Short marker: A, D, M, R, C or ·. */
  mark: string;
  additions: number;
  deletions: number;
  binary: boolean;
  tooLarge?: boolean;
  generated?: boolean;
  expandable: boolean;
  openable: boolean;
  disabledTitle?: string;
  /** Share of changed lines that are additions; 0 when there is no bar. */
  share: number;
}

export interface ChangedFileDiff {
  loading: boolean;
  error: string;
  data?: CommitComparison & { tooLarge?: boolean; binary?: boolean };
}
