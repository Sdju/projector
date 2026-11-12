import { randomBytes } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import {
  parseProjectScenarios,
  PROJECT_SCENARIOS_FILE,
  type ProjectScenarios,
} from "@ai-projector/core/modules/project/index.ts";

function outside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel.startsWith("..") || isAbsolute(rel);
}

/** Scenarios are authoritative in the project; `undefined` means there is no file yet. */
export async function readProjectScenarios(root: string): Promise<ProjectScenarios | undefined> {
  const file = join(root, PROJECT_SCENARIOS_FILE);
  let raw: string;
  try {
    const realRoot = await realpath(root);
    const real = await realpath(file);
    if (outside(realRoot, real)) throw new Error("Файл сценариев проекта указывает за его пределы");
    raw = await readFile(real, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return parseProjectScenarios(JSON.parse(raw) as unknown);
}

/** Writes `.projector/scenarios.json` atomically; a `.projector` symlink out of the project is refused. */
export async function writeProjectScenarios(
  root: string,
  scenarios: ProjectScenarios,
): Promise<void> {
  const file = join(root, PROJECT_SCENARIOS_FILE);
  const directory = dirname(file);
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) throw new Error("Папка проекта не найдена");
  await mkdir(directory, { recursive: true });
  const realRoot = await realpath(root);
  const realDirectory = await realpath(directory);
  if (outside(realRoot, realDirectory))
    throw new Error("Папка .projector указывает за пределы проекта");
  const temporary = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ version: 1, ...scenarios }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o644,
  });
  await rename(temporary, file);
}
