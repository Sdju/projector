import { mkdir, readFile, writeFile, rename, chmod } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { dataDir } from "../../../core/modules/app-paths/index.ts";

export interface IntegrationConfig {
  enabled: boolean;
  settings: Record<string, string>;
  credentials: Record<string, string>;
}
interface IntegrationFile {
  version: 1;
  integrations: Record<string, IntegrationConfig>;
}
export const integrationsPath = () => join(dataDir(), "integrations.json");
let queue = Promise.resolve();
export async function readIntegrations(): Promise<IntegrationFile> {
  try {
    const parsed = JSON.parse(await readFile(integrationsPath(), "utf8"));
    if (parsed.version !== 1 || !parsed.integrations || typeof parsed.integrations !== "object")
      throw new Error("Некорректный файл интеграций");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, integrations: {} };
    throw error;
  }
}
export async function integrationConfig(id: string): Promise<IntegrationConfig> {
  return (
    (await readIntegrations()).integrations[id] ?? { enabled: false, settings: {}, credentials: {} }
  );
}
export async function updateIntegration(
  id: string,
  update: (config: IntegrationConfig) => IntegrationConfig,
): Promise<void> {
  const operation = queue.then(async () => {
    const file = await readIntegrations();
    file.integrations[id] = update(
      file.integrations[id] ?? { enabled: false, settings: {}, credentials: {} },
    );
    await mkdir(dataDir(), { recursive: true });
    const tmp = `${integrationsPath()}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(file, null, 2) + "\n", { mode: 0o600 });
    await rename(tmp, integrationsPath());
    await chmod(integrationsPath(), 0o600);
  });
  queue = operation.catch(() => {});
  await operation;
}
