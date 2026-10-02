import { integrationsPath } from "./store.ts";
import { githubStatus } from "./github.ts";

// Each integration owns its settings, credentials and public status adapter.
export const integrationRegistry = [{ id: "github", status: githubStatus }];
export async function listIntegrations() {
  return {
    file: integrationsPath(),
    integrations: await Promise.all(integrationRegistry.map((plugin) => plugin.status())),
  };
}
