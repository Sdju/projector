export interface Integration {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  settings: { clientId: string; directory: string; url?: string };
  connected: boolean;
  account: string | null;
}
export interface DeviceLogin {
  id: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
}
export interface Repository {
  fullName: string;
  description: string | null;
  private: boolean;
  url: string;
}
export async function integrationRequest<T>(path = "", method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/integrations${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Ошибка интеграции");
  return data;
}
export type SecretStorage =
  | { backend: "keyring" }
  | { backend: "file"; reason: "disabled" | "unavailable" };
export const fetchIntegrations = () =>
  integrationRequest<{ file: string; secretStorage: SecretStorage; integrations: Integration[] }>();
