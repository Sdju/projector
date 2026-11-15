import { join } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import type { DevcontainerDecision } from "@ai-projector/core/modules/devcontainer/index.ts";
import { createTrustStore, type TrustRecord } from "../trusted-project-file/index.ts";

export interface TrustEntry extends TrustRecord {
  decision: DevcontainerDecision;
  configPath: string;
  decidedAt: string;
}

/** Решения по devcontainer.json: хеш покрывает конфигурацию и файлы, из которых она собирается. */
export const trustPath = () => join(dataDir(), "devcontainer-trust.json");

const store = createTrustStore<TrustEntry>({
  file: trustPath,
  fields: ["decision", "configPath", "hash", "decidedAt"],
  valid: (entry) => entry.decision === "trusted" || entry.decision === "declined",
  version: 1,
  // Запуск контейнера не должен угадывать: повреждённый файл решений — ошибка, а не «нет доверия».
  broken: "throw",
});

/** Decisions are keyed by the project's real path, not by the (renameable) project id. */
export function trustEntry(root: string): TrustEntry | undefined {
  return store.entrySync(root);
}
export async function saveTrust(root: string, entry: TrustEntry | null): Promise<void> {
  await store.set(root, entry);
}

/** Каталоги с сохранёнными решениями — вход реестра `project-trust`. */
export const trustRoots = () => store.roots().catch(() => []);
