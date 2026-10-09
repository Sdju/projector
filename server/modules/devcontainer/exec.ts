import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { os } from "../../../core/modules/os/index.ts";
import type { Project } from "../../../core/modules/project/index.ts";
import { loadProjects } from "../projects/index.ts";
import { trustedDevcontainer } from "./state.ts";

const UP_TTL = 120_000;
const UP_TIMEOUT = 10 * 60_000;
const cliPath = () => createRequire(import.meta.url).resolve("@devcontainers/cli/devcontainer.js");
const ready = new Map<string, { at: number; pending: Promise<void> }>();

function target(project: Project) {
  const config = trustedDevcontainer(project);
  if (!config) return undefined;
  const root = realpathSync(project.path);
  const flags = ["--workspace-folder", root, "--config", config.file];
  return { flags, key: `${root}\0${config.hash}` };
}
/** Builds/starts the container once for a while; concurrent callers share the same `up`. */
function ensureUp(key: string, flags: string[], signal?: AbortSignal) {
  const cached = ready.get(key);
  if (cached && Date.now() - cached.at < UP_TTL) return cached.pending;
  const pending = os.tools
    .runNodeScript(cliPath(), ["up", ...flags], { timeout: UP_TIMEOUT, signal })
    .then(() => undefined);
  const entry = { at: Date.now(), pending };
  ready.set(key, entry);
  pending.catch(() => {
    if (ready.get(key) === entry) ready.delete(key);
  });
  return pending;
}

/** True when commands for this project must run in its trusted Dev Container. */
export const usesDevcontainer = (project: Project) => !!target(project);

/** Runs a command inside the trusted Dev Container; rejects like `execFile` on a non-zero exit. */
export async function runDevcontainerCommand(
  project: Project,
  command: string[],
  timeout = 30_000,
  signal?: AbortSignal,
) {
  const resolved = target(project);
  if (!resolved) throw new Error("Проект не использует доверенный Dev Container");
  await ensureUp(resolved.key, resolved.flags, signal);
  try {
    return await os.tools.runNodeScript(cliPath(), ["exec", ...resolved.flags, ...command], {
      timeout,
      signal,
    });
  } catch (error) {
    // A container removed behind our back: forget it so the next call rebuilds.
    if (/not found|is not running/i.test(String((error as { stderr?: string }).stderr)))
      ready.delete(resolved.key);
    throw error;
  }
}

/** The project containing `path` whose commands run in a trusted Dev Container. */
export async function devcontainerForPath(path: string): Promise<Project | undefined> {
  const root = resolve(path);
  return (await loadProjects(true)).find((project) => {
    const rel = relative(project.path, root);
    return (
      rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) && usesDevcontainer(project)
    );
  });
}

/** Removes the project's dev container(s); files in the project are untouched. */
export async function stopDevcontainer(project: Project): Promise<{ removed: number }> {
  const root = realpathSync(project.path);
  const { stdout } = await os.tools.runDocker([
    "ps",
    "-aq",
    "--filter",
    `label=devcontainer.local_folder=${root}`,
  ]);
  const ids = stdout.split("\n").filter((id) => /^[a-f0-9]{12,64}$/.test(id));
  if (ids.length) await os.tools.runDocker(["rm", "--force", ...ids], { timeout: 60_000 });
  for (const key of ready.keys()) if (key.startsWith(`${root}\0`)) ready.delete(key);
  return { removed: ids.length };
}
