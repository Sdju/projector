import { realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { HttpError } from "../http/index.ts";

/**
 * The folder a scenario starts in: it must exist and resolve inside the project, so a link
 * cannot send a command out of the project.
 */
export function scenarioDirectory(root: string, folder: string): string {
  const target = join(root, folder);
  try {
    const real = realpathSync(target);
    const base = realpathSync(root);
    if (statSync(real).isDirectory() && (real === base || real.startsWith(base + sep)))
      return target;
  } catch {
    // reported below
  }
  throw new HttpError(400, `Папка сценария не найдена внутри проекта: ${folder}`);
}
