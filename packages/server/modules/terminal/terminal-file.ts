import { os } from "@projector-ai/core/modules/os/index.ts";
import { HttpError } from "../http/index.ts";
import type { Project } from "../projects/index.ts";
import { containerToHost, resolveTerminalPath } from "./link-files.ts";
import { state } from "./session-state.ts";

/** Resolves a path printed in a terminal against the project, container or shell directory. */
export async function resolveTerminalFile(project: Project, id: string, path: string) {
  const session = state.sessions.get(id);
  if (!session || session.info.projectId !== project.id)
    throw new HttpError(404, "Терминал не найден");
  if (session.info.docker)
    throw new HttpError(409, "Пути Docker-терминала не сопоставлены с файлами хоста");
  const workspace = session.info.devcontainer?.workspace;
  if (workspace)
    return resolveTerminalPath(
      containerToHost(path, workspace, project.path),
      project.path,
      project.path,
    );
  const resolve = async () => {
    const cwd =
      session.info.status === "running"
        ? await os.processes.workingDirectories(session.info.pid, project.path)
        : project.path;
    return resolveTerminalPath(path, project.path, cwd);
  };
  try {
    return await resolve();
  } catch (error) {
    // A reading of the shell's directory is occasionally missed on a busy Windows machine (seen
    // once in 80 runs, correct moments later); asking again settles it.
    if (os.platform !== "win32" || (error as { status?: number }).status !== 404) throw error;
    await new Promise((done) => setTimeout(done, 400));
    return resolve();
  }
}
