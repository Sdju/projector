import type { DockerEnvironment } from "../../../core/modules/environment/index.ts";
import { cloneInContainer } from "../git-import/index.ts";

/** HTTPS clone inside Docker; the GitLab token never appears in the command line. */
export async function cloneGitlabContainer(
  url: string,
  staging: string,
  token: string,
  environment: DockerEnvironment,
  signal?: AbortSignal,
): Promise<void> {
  await cloneInContainer({
    url,
    staging,
    token,
    environment,
    signal,
    username: "oauth2",
    tokenEnv: "PROJECTOR_GITLAB_TOKEN",
    id: "gitlab-clone",
    failure: "Не удалось клонировать проект внутри Docker. Проверьте сеть и права GitLab",
  });
}
