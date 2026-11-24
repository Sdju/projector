export const NETWORK_CONTEXT_URL = "https://ipwho.is/";

/** Usage requests are allowed from the EU and the USA. */
const ALLOWED_USAGE_COUNTRIES = new Set(["US"]);

/** One probe is shared by every usage reader: the region rarely changes within a minute. */
const CONTEXT_TTL_MS = 60_000;

type NetworkProbe = { success?: unknown; is_eu?: unknown; country_code?: unknown };

let allowedUntil = 0;
let pending: Promise<void> | null = null;

/** Test and HMR hook: the next usage request probes the network again. */
export function resetUsageNetworkContext(): void {
  allowedUntil = 0;
  pending = null;
}

function isAllowedUsageRegion(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const probe = body as NetworkProbe;
  if (probe.success !== true) return false;
  if (probe.is_eu === true) return true;
  return (
    typeof probe.country_code === "string" &&
    ALLOWED_USAGE_COUNTRIES.has(probe.country_code.toUpperCase())
  );
}

async function probeUsageNetworkContext(timeoutMs: number): Promise<void> {
  let response: Response;
  try {
    response = await fetch(NETWORK_CONTEXT_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  } catch {
    throw new Error("Не удалось проверить сетевой контекст");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Не удалось проверить сетевой контекст");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Не удалось проверить сетевой контекст");
  }
  if (!isAllowedUsageRegion(body)) throw new Error("Не удалось проверить сетевой контекст");
}

/**
 * Fixed public probe; usage requests must not run outside the allowed regions. A successful
 * probe is cached for a minute so Codex and Cursor share one request; failures are retried.
 */
export async function assertUsageNetworkContext(timeoutMs: number): Promise<void> {
  if (Date.now() < allowedUntil) return;
  pending ??= probeUsageNetworkContext(timeoutMs)
    .then(() => {
      allowedUntil = Date.now() + CONTEXT_TTL_MS;
    })
    .finally(() => {
      pending = null;
    });
  await pending;
}
