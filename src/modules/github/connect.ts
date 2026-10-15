import { fetchIntegrations, integrationRequest } from "../integration-api/index.ts";
import type { Integration } from "../integration-api/index.ts";

/** Both connection forms enable GitHub before authenticating the trimmed token. */
export async function connectGithubToken(
  token: string,
  settings?: Integration["settings"],
  onSettingsSaved?: (integration: Integration) => void,
) {
  const value = token.trim();
  if (!value) throw new Error("Укажите токен GitHub");
  if (settings) {
    const saved = await integrationRequest<Integration>("/github", "PUT", {
      ...settings,
      enabled: true,
    });
    onSettingsSaved?.(saved);
  } else {
    const data = await fetchIntegrations();
    const github = data.integrations.find((integration) => integration.id === "github");
    if (!github?.enabled)
      await integrationRequest("/github", "PUT", { ...github?.settings, enabled: true });
  }
  return integrationRequest<Integration>("/github/auth", "POST", { token: value });
}
