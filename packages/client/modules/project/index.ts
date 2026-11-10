export { emptyDraft, useProjects } from "./model/store.ts";
export type {
  LaunchMode,
  ProcessSnapshot,
  Project,
  ProjectCommand,
  ProjectDraft,
} from "./model/types.ts";
export {
  commandError,
  duplicateCommand,
  missingCommands,
  projectDraft,
  settingsError,
} from "./model/project-settings.ts";
export {
  fetchDirectories,
  fetchPathSuggestions,
  fetchProjectGithub,
  fetchProjectGitlab,
  inspectCommands,
  inspectPath,
  pickFolder,
  previewIconUrl,
  projectIconUrl,
  hostedProjectIconUrl,
} from "./api/client.ts";
export { shortPath, statusLabel } from "./format.ts";
export {
  projectRoute,
  projectPathFromParams,
  githubRepositoryFromParams,
  gitlabProjectFromParams,
  gitlabOpenRoute,
} from "./project-route.ts";
export {
  parseProjectRef,
  formatProjectRef,
  projectRefSegments,
  isAbsoluteLocalPath,
} from "@ai-projector/core/modules/project/index.ts";
export type { ProjectRef } from "@ai-projector/core/modules/project/index.ts";
export {
  GITLAB_DEFAULT_INSTANCE,
  GITLAB_PREFIX,
  normalizeGitlabInstance,
  normalizeGitlabProjectPath,
  gitlabProjectRoute,
  gitlabProjectKey,
} from "@ai-projector/core/modules/gitlab/index.ts";
export type {
  GitlabRepository,
  GitlabEntry,
  GitlabFile,
} from "@ai-projector/core/modules/gitlab/index.ts";
export type { ProjectLocation } from "./model/types.ts";
export { default as ProjectOpening } from "./ui/ProjectOpening.vue";
