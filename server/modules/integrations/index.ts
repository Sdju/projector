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

export { configureGithub } from "./github.ts";
export { connectGithub } from "./github.ts";
export { disconnectGithub } from "./github.ts";
export { beginGithubLogin } from "./github.ts";
export { pollGithubLogin } from "./github.ts";
export { githubRepositories } from "./github.ts";
export { importGithubProject } from "./github.ts";

export type { IntegrationConfig } from "./store.ts";
export { readIntegrations } from "./store.ts";
export { integrationConfig } from "./store.ts";
export { updateIntegration } from "./store.ts";
