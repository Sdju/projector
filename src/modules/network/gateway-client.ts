export interface GatewayState {
  enabled: boolean;
  baseUrl: string;
}

export async function readGatewayState(signal?: AbortSignal): Promise<GatewayState> {
  const response = await fetch("/api/openai", { cache: "no-store", signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Не удалось загрузить настройки OpenAI API");
  return data;
}

export async function saveGatewayEnabled(
  enabled: boolean,
  signal?: AbortSignal,
): Promise<GatewayState> {
  const response = await fetch("/api/openai", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
    signal,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Не удалось сохранить настройки OpenAI API");
  return data;
}
