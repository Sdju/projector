import { join } from "node:path";
import { realpath, writeFile, rm } from "node:fs/promises";
import type { Project } from "../../../core/modules/project/index.ts";
import type { DockerEnvironment } from "../../../core/modules/environment/index.ts";
import { runEnvironmentCommand } from "../environments/index.ts";
import { HttpError } from "../http/index.ts";

const CLONE = String.raw`cat > /tmp/askpass <<'ASKPASS'
#!/bin/sh
case "$1" in
  *Username*) printf "%s\n" "x-access-token" ;;
  *) printf "%s\n" "$PROJECTOR_GITHUB_TOKEN" ;;
esac
ASKPASS
chmod 700 /tmp/askpass
export GIT_ASKPASS=/tmp/askpass GIT_TERMINAL_PROMPT=0
exec git -c credential.helper= -c core.hooksPath=/dev/null -c http.followRedirects=false clone -- "$1" /workspace/checkout`;

/** HTTPS clone is the only container receiving the scoped GitHub credential. */
export async function cloneGithubContainer(
  repository: string,
  staging: string,
  token: string,
  environment: DockerEnvironment,
  signal?: AbortSignal,
) {
  if (token.includes("\n") || token.includes("\r"))
    throw new HttpError(400, "Некорректный GitHub token");
  const credentials = join(staging, ".clone-credentials");
  await writeFile(credentials, `PROJECTOR_GITHUB_TOKEN=${token}\n`, { mode: 0o600 });
  const project: Project = {
    id: "github-clone",
    name: repository,
    path: await realpath(staging),
    url: "",
    icon: "",
    mode: "server",
    commands: [],
    defaultCommandId: "",
    createdAt: new Date().toISOString(),
    environment: { ...environment, network: "bridge", ports: [] },
  };
  try {
    await runEnvironmentCommand(
      project,
      [
        "/bin/bash",
        "--noprofile",
        "--norc",
        "-c",
        CLONE,
        "projector-clone",
        `https://github.com/${repository}.git`,
      ],
      300_000,
      signal,
      credentials,
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new HttpError(
      400,
      "Не удалось клонировать репозиторий внутри Docker. Проверьте сеть и права GitHub",
    );
  } finally {
    await rm(credentials, { force: true });
  }
}
