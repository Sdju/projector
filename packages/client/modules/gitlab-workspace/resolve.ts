import { addWorkspaceProfileResolver } from "../workspace-api/index.ts";
import { parseProjectRef } from "../project/index.ts";

/** A GitLab project exists only while its view is mounted and has published its profile. */
addWorkspaceProfileResolver({
  match: (projectId) => parseProjectRef(projectId).kind === "gitlab",
  create: () => {
    throw new Error("Проект GitLab не открыт");
  },
});
