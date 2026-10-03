import { addWorkspaceProfileResolver } from "../workspace-api/index.ts";
import { parseProjectRef } from "../project/index.ts";

/** A GitHub project exists only while its view is mounted and has published its profile. */
addWorkspaceProfileResolver({
  match: (projectId) => parseProjectRef(projectId).kind === "github",
  create: () => {
    throw new Error("Репозиторий GitHub не открыт");
  },
});
export { default as GithubWorkspace } from "./GithubWorkspace.vue";
