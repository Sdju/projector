import { join } from "node:path";
import { realpath, writeFile, rm } from "node:fs/promises";
import { os } from "../../../core/modules/os/index.ts";
import type { Project } from "../../../core/modules/project/index.ts";
import type { DockerEnvironment } from "../../../core/modules/environment/index.ts";
import { runEnvironmentCommand } from "../environments/index.ts";
import { HttpError } from "../http/index.ts";

export interface ContainerClone {
  /** HTTPS URL of the repository; passed to `git clone` as an argument, never interpolated. */
  url: string;
  /** Temporary directory the container mounts as `/workspace`. */
  staging: string;
  token: string;
  environment: DockerEnvironment;
  signal?: AbortSignal;
  /** HTTPS user name the host expects together with the token. */
  username: string;
  /** Environment variable that carries the token to the askpass helper. */
  tokenEnv: string;
  /** Project id used only for the temporary Docker launch. */
  id: string;
  /** Shown when the clone fails; never includes the token. */
  failure: string;
}

const cloneScript = (
  username: string,
  tokenEnv: string,
) => String.raw`cat > /tmp/askpass <<'ASKPASS'
#!/bin/sh
case "$1" in
  *Username*) printf "%s\n" "${username}" ;;
  *) printf "%s\n" "$${tokenEnv}" ;;
esac
ASKPASS
chmod 700 /tmp/askpass
export GIT_ASKPASS=/tmp/askpass GIT_TERMINAL_PROMPT=0
exec git -c credential.helper= -c core.hooksPath=/dev/null -c http.followRedirects=false clone -- "$1" /workspace/checkout`;

/**
 * HTTPS clone inside the project's Docker environment. The credential reaches the container only
 * through a 0600 `--env-file`, and the URL stays an argument so no token appears in the command.
 */
export async function cloneInContainer({
  url,
  staging,
  token,
  environment,
  signal,
  username,
  tokenEnv,
  id,
  failure,
}: ContainerClone): Promise<void> {
  if (token.includes("\n") || token.includes("\r")) throw new HttpError(400, failure);
  const credentials = join(staging, ".clone-credentials");
  await writeFile(credentials, `${tokenEnv}=${token}\n`, { mode: 0o600 });
  await os.tools.restrictToOwner(credentials);
  const project: Project = {
    id,
    name: url,
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
        cloneScript(username, tokenEnv),
        "projector-clone",
        url,
      ],
      300_000,
      signal,
      credentials,
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new HttpError(400, failure);
  } finally {
    await rm(credentials, { force: true });
  }
}
