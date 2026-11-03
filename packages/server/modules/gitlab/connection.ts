import {
  fieldText as text,
  integrationConfig,
  revealIntegrationToken,
  updateIntegration,
} from "../integration-store/index.ts";
import { HttpError } from "../http/index.ts";
import { expandPath } from "../projects/index.ts";
import { GITLAB_DIRECTORY, GITLAB_URL, gitlabBaseUrl } from "./base.ts";
import { beginGitlabDeviceLogin, clearGitlabSessions, pollGitlabDevice } from "./oauth.ts";

export async function gitlabStatus() {
  const config = await integrationConfig("gitlab");
  const oauth = config.credentials.kind === "oauth";
  return {
    id: "gitlab",
    name: "GitLab",
    description: "Импорт проектов GitLab (gitlab.com и self-hosted) в локальный каталог",
    enabled: config.enabled,
    settings: {
      clientId: config.settings.clientId ?? "",
      url: config.settings.url || GITLAB_URL,
      directory: config.settings.directory || GITLAB_DIRECTORY,
    },
    connected: !!config.credentials.token,
    auth: config.credentials.token ? (oauth ? "oauth" : "pat") : null,
    account: config.credentials.login || null,
  };
}

export const revealGitlabToken = () => revealIntegrationToken("gitlab");

export async function configureGitlab(body: Record<string, unknown>) {
  if (typeof body.enabled !== "boolean") throw new HttpError(400, "Укажите состояние интеграции");
  const directory = text(body.directory);
  if (!directory) throw new HttpError(400, "Укажите папку для импорта");
  const clientId = text(body.clientId);
  const url = gitlabBaseUrl(body.url);
  clearGitlabSessions();
  await updateIntegration("gitlab", (config) => ({
    ...config,
    enabled: body.enabled as boolean,
    settings: { clientId, url, directory: expandPath(directory) },
    // A token belongs to one instance: another address means signing in again.
    credentials: config.settings.url && config.settings.url !== url ? {} : config.credentials,
  }));
  return gitlabStatus();
}

export async function disconnectGitlab() {
  clearGitlabSessions();
  await updateIntegration("gitlab", (config) => ({ ...config, credentials: {} }));
  return gitlabStatus();
}

export async function beginGitlabLogin() {
  return beginGitlabDeviceLogin();
}

/** Device Flow step: pending states stay internal, a finished login returns the public status. */
export async function pollGitlabLogin(body: Record<string, unknown>) {
  const result = await pollGitlabDevice(body);
  return result.pending ? result : { ...result, integration: await gitlabStatus() };
}
