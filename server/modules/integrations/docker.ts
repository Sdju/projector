import { integrationConfig } from "./store.ts";

/** Registry metadata; live daemon health is owned by the Docker module. */
export async function dockerIntegrationStatus() {
  const config = await integrationConfig("docker");
  return {
    id: "docker",
    name: "Docker",
    description: "Локальные контейнеры и Compose-окружения",
    enabled: config.enabled,
    settings: { context: config.settings.context || "default" },
  };
}
