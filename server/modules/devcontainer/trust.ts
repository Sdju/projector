import { mkdir, rename, writeFile } from "node:fs/promises";
import { os } from "../../../core/modules/os/index.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { dataDir } from "../../../core/modules/app-paths/index.ts";
import type { DevcontainerDecision } from "../../../core/modules/devcontainer/index.ts";

export interface TrustEntry {
  decision: DevcontainerDecision;
  configPath: string;
  hash: string;
  decidedAt: string;
}
interface TrustFile {
  version: 1;
  projects: Record<string, TrustEntry>;
}
export const trustPath = () => join(dataDir(), "devcontainer-trust.json");
let queue = Promise.resolve();

function read(): TrustFile {
  try {
    const parsed = JSON.parse(readFileSync(trustPath(), "utf8"));
    if (parsed.version !== 1 || typeof parsed.projects !== "object" || !parsed.projects)
      throw new Error("Некорректный файл доверия");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, projects: {} };
    throw error;
  }
}
/** Decisions are keyed by the project's real path, not by the (renameable) project id. */
export function trustEntry(root: string): TrustEntry | undefined {
  return read().projects[root];
}
export async function saveTrust(root: string, entry: TrustEntry | null): Promise<void> {
  const operation = queue.then(async () => {
    const file = read();
    if (entry) file.projects[root] = entry;
    else delete file.projects[root];
    await mkdir(dataDir(), { recursive: true });
    const tmp = `${trustPath()}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(file, null, 2) + "\n", { mode: 0o600 });
    await rename(tmp, trustPath());
    await os.tools.restrictToOwner(trustPath());
  });
  queue = operation.catch(() => {});
  await operation;
}
