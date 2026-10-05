import { ref } from "vue";
import { defaultFilesExclude, type FilesExcludeMap } from "../../../../../../core/modules/workspace/index.ts";

export const filesExcludeRevision = ref(0);

export function bumpFilesExcludeRevision() {
  filesExcludeRevision.value++;
}

export function enabledExcludePatterns(exclude: FilesExcludeMap): string[] {
  return Object.entries(exclude)
    .filter(([, enabled]) => enabled)
    .map(([pattern]) => pattern)
    .sort((a, b) => a.localeCompare(b));
}

export { defaultFilesExclude };
