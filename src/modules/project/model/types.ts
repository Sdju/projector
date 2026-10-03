export type {
  LaunchMode,
  ProcessStatus,
  ProjectCommand,
  Project,
  ProcessSnapshot,
  ProjectDraft,
} from "../../../../core/modules/project/index.ts";

/** A workspace location can be displayed without registering a runnable local project. */
export interface ProjectLocation {
  id: string;
  name: string;
  path: string;
  icon?: string;
  iconUrl?: string;
}
