import { integrationsPath, migrateIntegrationSecrets } from "./store.ts";
import { vault } from "../secrets/index.ts";
import { githubStatus } from "./github.ts";
import { dockerIntegrationStatus } from "./docker.ts";

// Each integration owns its settings, credentials and public status adapter.
export const integrationRegistry = [
  { id: "github", status: githubStatus },
  { id: "docker", status: dockerIntegrationStatus },
];
export async function listIntegrations() {
  // Plaintext credentials left by older versions move into the keyring on first view.
  await migrateIntegrationSecrets().catch((error) =>
    console.error("Перенос секретов в системное хранилище:", error.message),
  );
  return {
    file: integrationsPath(),
    secretStorage: await vault.storage(),
    integrations: await Promise.all(integrationRegistry.map((plugin) => plugin.status())),
  };
}

export { configureGithub } from "./github.ts";
export { connectGithub } from "./github.ts";
export { disconnectGithub } from "./github.ts";
export { beginGithubLogin } from "./github.ts";
export { pollGithubLogin } from "./github.ts";
export { githubRepositories } from "./github.ts";
export { cloneGithubProject } from "./github-clone.ts";
export { importGithubProject } from "./github-clone.ts";
export { startCloneJob, cloneJob, cancelCloneJob } from "./clone-jobs.ts";

export type { IntegrationConfig } from "./store.ts";
export { readIntegrations } from "./store.ts";
export { integrationConfig } from "./store.ts";
export { updateIntegration } from "./store.ts";
export { revealGithubToken } from "./github.ts";

export {
  browseGithubRepository,
  browseGithubTree,
  browseGithubFile,
  browseGithubAsset,
} from "./github-browser.ts";

export { browseGithubLog, browseGithubCommit, browseGithubComparison } from "./github-history.ts";

export { browseGithubDirectories } from "./github-navigation.ts";

export { browseGithubIssue, browseGithubIssues } from "./github-issues.ts";
