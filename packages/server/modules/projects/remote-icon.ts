const ICON_LIMIT = 2 * 1024 * 1024;

/**
 * Bytes of a project avatar/logo hosted by GitHub or GitLab. The URL comes from the host API, but
 * redirects and non-image responses are rejected so it cannot become a generic proxy.
 */
export async function fetchRemoteIcon(
  url: string,
): Promise<{ mime: string; bytes: Buffer } | null> {
  if (!url) return null;
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") return null;
  let response: Response;
  try {
    response = await fetch(target, {
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "Projector" },
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > ICON_LIMIT) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > ICON_LIMIT) return null;
  const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
  return mime.startsWith("image/") ? { mime, bytes } : null;
}
