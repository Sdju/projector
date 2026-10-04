import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { os } from "../../../core/modules/os/index.ts";
import type { Project } from "../../../core/modules/project/index.ts";
import { loadProjects } from "../projects/index.ts";
import { HttpError } from "../http/index.ts";

export function environmentLaunch(project: Project, command: string[], interactive = true, publish = true) {
  const environment = project.environment;
  if (!environment) throw new HttpError(409, "Проект не использует Docker");
  const root = realpathSync(project.path);
  if (root !== project.path || root.includes(",")) throw new HttpError(409, "Путь Docker-проекта изменён или содержит запятую");
  const { uid, gid } = os.userIdentity();
  if (uid <= 0) throw new HttpError(409, "Docker-окружение требует непривилегированного пользователя Projector");
  const name = `projector-env-${randomUUID()}`;
  const args = ["--context", environment.context, "run", "--rm", "--name", name,
    "--label", `io.projector.environment=${project.id}`, "--init",
    "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges:true",
    "--pids-limit=256", "--memory=2g", "--memory-swap=2g", "--cpus=2",
    "--user", `${uid}:${gid}`, "--network", environment.network,
    "--mount", `type=bind,source=${root},target=/workspace`,
    "--tmpfs", "/tmp:rw,nosuid,nodev,size=256m",
    "--tmpfs", `/home/node:rw,nosuid,nodev,uid=${uid},gid=${gid},size=256m`,
    "--workdir", "/workspace", "--env", "HOME=/home/node", "--env", "TERM=xterm-256color",
    "--env", "GIT_CONFIG_GLOBAL=/dev/null", "--env", "GIT_CONFIG_NOSYSTEM=1",
    "--entrypoint", "/bin/bash"];
  if (interactive) args.push("-it");
  if (publish && environment.network !== "none")
    for (const port of environment.ports) args.push("-p", `127.0.0.1::${port}`);
  args.push(environment.image, "--noprofile", "--norc", "-c",
    'mkdir -p /tmp/projector-bin; if command -v corepack >/dev/null; then corepack enable --install-directory /tmp/projector-bin; fi; export PATH="/tmp/projector-bin:/workspace/node_modules/.bin:$PATH"; exec "$@"',
    "projector-environment", ...command);
  return { file: "docker", args, title: `Docker · ${project.name}`,
    docker: { context: environment.context, kind: "environment", containerId: name } };
}
export async function stopEnvironmentContainer(context: string, name: string, retry = false) {
  if (!/^projector-env-[a-f0-9-]{36}$/.test(name)) throw new Error("Некорректное имя окружения");
  // Retry if the PTY client was stopped while Docker was still creating the container.
  for (let attempt = 0; attempt < (retry ? 10 : 1); attempt++) {
    try {
      await os.tools.runDocker(["--context", context, "rm", "--force", name]);
      return;
    } catch {
      await new Promise((done) => setTimeout(done, 100));
    }
  }
}
export async function environmentForPath(path: string): Promise<Project | undefined> {
  const root = resolve(path);
  return (await loadProjects(true)).find((project) => {
    const rel = relative(project.path, root);
    return project.environment && rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
  });
}
export async function runEnvironmentCommand(project: Project, command: string[], timeout = 30_000, signal?: AbortSignal, credentialFile?: string) {
  const launch = environmentLaunch(project, command, false, false);
  if (credentialFile) launch.args.splice(launch.args.indexOf("--entrypoint"), 0, "--env-file", credentialFile);
  try {
    return await os.tools.runDocker(launch.args, { timeout, signal });
  } finally {
    await stopEnvironmentContainer(launch.docker.context, launch.docker.containerId);
  }
}

export async function environmentPorts(context: string, name: string): Promise<Array<{ container: number; url: string }>> {
  const result = await os.tools.runDocker(["--context", context, "port", name]);
  return result.stdout.trim().split("\n").flatMap((line) => {
    const match = /^(\d+)\/tcp -> 127\.0\.0\.1:(\d+)$/.exec(line);
    return match ? [{ container: Number(match[1]), url: `http://127.0.0.1:${match[2]}` }] : [];
  });
}
export function stopEnvironmentContainerSync(context: string, name: string) {
  if (!/^projector-env-[a-f0-9-]{36}$/.test(name)) return;
  try { os.tools.runDockerSync(["--context", context, "rm", "--force", name]); } catch { /* Already gone. */ }
}
