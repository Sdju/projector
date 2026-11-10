import type { DockerEnvironment } from "@ai-projector/core/modules/environment/index.ts";
import { cloneInContainer } from "../git-import/index.ts";

/** HTTPS clone is the only container receiving the scoped GitHub credential. */
export async function cloneGithubContainer(
  repository: string,
  staging: string,
  token: string,
  environment: DockerEnvironment,
  signal?: AbortSignal,
): Promise<void> {
  await cloneInContainer({
    url: `https://github.com/${repository}.git`,
    staging,
    token,
    environment,
    signal,
    username: "x-access-token",
    tokenEnv: "PROJECTOR_GITHUB_TOKEN",
    id: "github-clone",
    failure: "Не удалось клонировать репозиторий внутри Docker. Проверьте сеть и права GitHub",
  });
}
