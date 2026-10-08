import { mkdir, mkdtemp, rm, rename, lstat, rmdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { DockerEnvironment } from "../../../core/modules/environment/index.ts";
import { HttpError } from "../http/index.ts";
import { expandPath, inspectProject, loadProjects, updateProjects } from "../projects/index.ts";
import type { Project } from "../projects/index.ts";

const imports = new Set<string>();

export interface ImportHooks {
  signal?: AbortSignal;
  phase?: (phase: "cloning" | "finishing") => void;
}
export interface ImportOptions {
  /** Import folder; the project lands in `<directory>/<...segments>`. */
  directory: string;
  segments: string[];
  /** Fills `checkout` (inside `staging`); a host adapter decides how. */
  clone: (target: { staging: string; checkout: string }) => Promise<void>;
  environment?: DockerEnvironment;
  hooks?: ImportHooks;
}

/**
 * Host-independent import: claims the destination, clones into staging, describes the project
 * and registers it. Nothing is installed or run; existing folders are never overwritten.
 */
export async function importRepository({
  directory: base,
  segments,
  clone,
  environment,
  hooks = {},
}: ImportOptions) {
  const directory = expandPath(base);
  const destination = join(directory, ...segments);
  if (imports.has(destination)) throw new HttpError(409, "Этот репозиторий уже импортируется");
  imports.add(destination);
  let staging = "";
  try {
    if ((await loadProjects()).some((project) => project.path === destination))
      throw new HttpError(409, "Проект уже добавлен");
    if (
      await lstat(destination).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      })
    )
      throw new HttpError(
        409,
        "Папка уже существует. Добавьте её как локальный проект или выберите другую папку импорта",
      );
    const parent = join(directory, ...segments.slice(0, -1));
    await mkdir(parent, { recursive: true });
    staging = await mkdtemp(join(parent, ".projector-import-"));
    const checkout = join(staging, "checkout");
    hooks.signal?.throwIfAborted();
    hooks.phase?.("cloning");
    await clone({ staging, checkout });
    hooks.signal?.throwIfAborted();
    hooks.phase?.("finishing");
    let draft;
    if (await lstat(join(checkout, "package.json")).catch(() => null)) {
      draft = await inspectProject(checkout);
      draft.icon = draft.icon ? draft.icon.replace(checkout, destination) : "";
    } else {
      const command = { id: randomUUID(), name: "git status", cmd: "git status" };
      draft = {
        name: segments[segments.length - 1],
        url: "",
        icon: "",
        mode: "server" as const,
        commands: [command],
        defaultCommandId: command.id,
      };
    }
    // Claim the destination atomically, including against another Projector process.
    try {
      await mkdir(destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new HttpError(409, "Папка уже существует");
      throw error;
    }
    try {
      // POSIX rename replaces an empty directory. Windows MoveFileEx returns EPERM instead.
      if (process.platform === "win32") await rmdir(destination);
      await rename(checkout, destination);
    } catch (error) {
      await rmdir(destination).catch(() => {});
      throw error;
    }
    const project: Project = {
      ...draft,
      path: await realpath(destination),
      environment,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    await updateProjects((projects) => {
      projects.unshift(project);
    });
    return { project };
  } finally {
    imports.delete(destination);
    if (staging) await rm(staging, { recursive: true, force: true });
  }
}
