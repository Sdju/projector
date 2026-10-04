import { mkdir, readFile, writeFile, rename, chmod } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { dataDir } from "../../../core/modules/app-paths/index.ts";
import { vault as systemVault } from "../secrets/index.ts";

export interface IntegrationConfig {
  enabled: boolean;
  settings: Record<string, string>;
  credentials: Record<string, string>;
  /** Set on reads when the keyring entry exists but could not be opened. */
  credentialsError?: string;
}
/** On disk, `vault: "keyring"` means `credentials` live in the OS keyring, not in the file. */
interface StoredIntegration extends Omit<IntegrationConfig, "credentialsError"> {
  vault?: "keyring";
}
interface IntegrationFile {
  version: 1;
  integrations: Record<string, StoredIntegration>;
}
let vault = systemVault;
/** Test hook: replaces the secret vault. */
export const useIntegrationVault = (next: typeof systemVault) => {
  vault = next;
};
const account = (id: string) => `integration:${id}`;
const empty = (): StoredIntegration => ({ enabled: false, settings: {}, credentials: {} });
export const integrationsPath = () => join(dataDir(), "integrations.json");
let queue = Promise.resolve();

async function readFileRaw(): Promise<IntegrationFile> {
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
async function writeFileRaw(file: IntegrationFile) {
  await mkdir(dataDir(), { recursive: true });
  const tmp = `${integrationsPath()}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2) + "\n", { mode: 0o600 });
  await rename(tmp, integrationsPath());
  await chmod(integrationsPath(), 0o600);
}
/** Strict: a locked, denied or broken keyring throws instead of looking like "no credentials". */
async function openCredentials(id: string, stored: StoredIntegration) {
  if (stored.vault !== "keyring") return stored.credentials ?? {};
  const secret = await vault.get(account(id));
  return secret ? (JSON.parse(secret) as Record<string, string>) : {};
}
async function resolve(id: string, stored: StoredIntegration): Promise<IntegrationConfig> {
  const { vault: _vault, ...config } = stored;
  try {
    return { ...config, credentials: await openCredentials(id, stored) };
  } catch (error) {
    const message = (error as Error).message;
    console.error(`Интеграция ${id}: секреты недоступны: ${message}`);
    return { ...config, credentials: {}, credentialsError: message };
  }
}

export async function readIntegrations() {
  const file = await readFileRaw();
  const integrations: Record<string, IntegrationConfig> = {};
  for (const [id, stored] of Object.entries(file.integrations))
    integrations[id] = await resolve(id, stored);
  return { version: file.version, integrations };
}
export async function integrationConfig(id: string): Promise<IntegrationConfig> {
  return resolve(id, (await readFileRaw()).integrations[id] ?? empty());
}

/** Writes credentials to the keyring when available, else keeps them in the 0600 file. */
async function persistCredentials(
  id: string,
  credentials: Record<string, string>,
  previous: StoredIntegration,
): Promise<Pick<StoredIntegration, "credentials" | "vault">> {
  if (!Object.keys(credentials).length) {
    if (previous.vault === "keyring") await vault.delete(account(id));
    return { credentials: {} };
  }
  if ((await vault.storage()).backend !== "keyring") return { credentials };
  await vault.set(account(id), `Projector: ${id}`, JSON.stringify(credentials));
  return { credentials: {}, vault: "keyring" };
}

export async function updateIntegration(
  id: string,
  update: (config: IntegrationConfig) => IntegrationConfig,
): Promise<void> {
  const operation = queue.then(async () => {
    const file = await readFileRaw();
    const stored = file.integrations[id] ?? empty();
    const credentials = await openCredentials(id, stored);
    const { credentialsError: _error, credentials: next, ...rest } = update({
      enabled: stored.enabled,
      settings: stored.settings,
      credentials,
    });
    const persisted = await persistCredentials(id, next, stored);
    file.integrations[id] = { ...rest, ...persisted };
    await writeFileRaw(file);
  });
  queue = operation.catch(() => {});
  await operation;
}

/**
 * Moves plaintext credentials into the keyring once it is reachable.
 * The file is rewritten only after the stored value reads back identically.
 */
export async function migrateIntegrationSecrets(): Promise<string[]> {
  const operation = queue.then(async () => {
    if ((await vault.storage()).backend !== "keyring") return [];
    const file = await readFileRaw();
    const moved: string[] = [];
    for (const [id, stored] of Object.entries(file.integrations)) {
      if (stored.vault || !Object.keys(stored.credentials ?? {}).length) continue;
      const payload = JSON.stringify(stored.credentials);
      await vault.set(account(id), `Projector: ${id}`, payload);
      if ((await vault.get(account(id))) !== payload) throw new Error(`Не удалось проверить секреты ${id}`);
      file.integrations[id] = { ...stored, credentials: {}, vault: "keyring" };
      moved.push(id);
    }
    if (moved.length) await writeFileRaw(file);
    return moved;
  });
  queue = operation.then(
    () => {},
    () => {},
  );
  return operation;
}

/**
 * Returns one credential for display, only while it is protected by the keyring.
 * Plaintext file credentials are never offered for viewing.
 */
export async function revealIntegrationCredential(id: string, name: string) {
  const stored = (await readFileRaw()).integrations[id];
  if (stored?.vault !== "keyring") return undefined;
  return (await openCredentials(id, stored))[name];
}
