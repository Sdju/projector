import { cloneOverHttps, importRepository } from "../git-import/index.ts";
import { gitlab, gitlabAuthorized, gitlabProjectName, GITLAB_DIRECTORY } from "./api.ts";

const credentials = {
  username: "oauth2",
  tokenEnv: "PROJECTOR_GITLAB_TOKEN",
  failure: "Не удалось клонировать проект. Проверьте Git, сеть и права токена (read_repository)",
};

/** Clones a GitLab project into `<import folder>/<group>/<subgroup>/<project>` and registers it. */
export async function importGitlabProject(body: Record<string, unknown>) {
  const config = await gitlabAuthorized();
  const token = config.credentials.token;
  const project = await gitlab<{ path_with_namespace: string; http_url_to_repo: string }>(
    config.base,
    `/projects/${encodeURIComponent(gitlabProjectName(body.repository, config.base))}`,
    token,
  );
  return importRepository({
    directory: config.settings.directory || GITLAB_DIRECTORY,
    segments: project.path_with_namespace.split("/"),
    clone: ({ checkout }) => cloneOverHttps(project.http_url_to_repo, checkout, token, credentials),
  });
}
