import { vault } from "../secrets/index.ts";
import { integrationsPath, migrateIntegrationSecrets } from "./store.ts";

/** Settings overview: every service supplies its own public status; this adds file and vault info. */
export async function listIntegrations(statuses: Array<() => Promise<unknown>>) {
  // Plaintext credentials left by older versions move into the keyring on first view.
  await migrateIntegrationSecrets().catch((error) =>
    console.error("Перенос секретов в системное хранилище:", error.message),
  );
  return {
    file: integrationsPath(),
    secretStorage: await vault.storage(),
    integrations: await Promise.all(statuses.map((status) => status())),
  };
}
