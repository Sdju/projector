import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { os } from "@projector/core/modules/os/index.ts";

const DEFAULT_OAUTH_HOST = "https://auth.kimi.com";
const UNAVAILABLE = "Авторизация Kimi Code недоступна; выполните kimi login";

export interface KimiConfig {
  baseUrl: string | null;
  oauthHost: string | null;
  key: string | null;
  storage: string | null;
  region: string | null;
}

export const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function positiveNumber(value: unknown, seconds = false): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return seconds && parsed > 1e12 ? parsed / 1000 : parsed;
}

/** `KIMI_CODE_HOME` is the CLI's own override; the default is `~/.kimi-code`. */
export function kimiHome(): string {
  return process.env.KIMI_CODE_HOME?.trim() || join(os.homeDirectory(), ".kimi-code");
}

/** A minimal reader for the two `config.toml` tables Projector needs; no TOML dependency. */
function parseSections(content: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const header = trimmed.match(/^\[([^\]]+)]/);
    if (header) {
      current = header[1]!.trim();
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (current) sections.get(current)!.push(line);
  }
  return sections;
}

function stringValue(lines: readonly string[] | undefined, key: string): string | null {
  if (!lines) return null;
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`);
  for (const line of lines) {
    const match = line.match(pattern);
    if (!match) continue;
    try {
      return JSON.parse(`"${match[1]}"`) as string;
    } catch {
      return match[1]!;
    }
  }
  return null;
}

function jwtRegion(accessToken: string): string | null {
  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = record(JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")));
    return typeof payload?.region === "string" ? payload.region : null;
  } catch {
    return null;
  }
}

function hostFromRegion(region: string | null): string | null {
  if (!region) return null;
  const value = region.toLowerCase();
  if (value.includes("overseas") || value.includes("global")) return "https://auth.kimi.ai";
  if (value.includes("mainland") || value === "cn" || value.includes("china"))
    return "https://auth.kimi.com";
  return null;
}

function hostFromBaseUrl(baseUrl: string | null): string | null {
  if (!baseUrl) return null;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host === "kimi.ai" || host.endsWith(".kimi.ai")) return "https://auth.kimi.ai";
    if (host === "kimi.com" || host.endsWith(".kimi.com")) return "https://auth.kimi.com";
  } catch {
    /* A malformed override cannot name a host. */
  }
  return null;
}

function resolveOAuthHost(config: KimiConfig, accessToken: string): string {
  return (
    stringField(process.env.KIMI_OAUTH_HOST) ??
    stringField(process.env.KIMI_CODE_OAUTH_HOST) ??
    config.oauthHost ??
    hostFromRegion(jwtRegion(accessToken)) ??
    hostFromBaseUrl(config.baseUrl) ??
    hostFromRegion(config.region) ??
    DEFAULT_OAUTH_HOST
  );
}

export async function readKimiConfig(): Promise<KimiConfig> {
  const home = kimiHome();
  const [content, region] = await Promise.all([
    readFile(join(home, "config.toml"), "utf8").catch(() => ""),
    readFile(join(home, "region"), "utf8").catch(() => ""),
  ]);
  const sections = parseSections(content);
  const provider = sections.get('providers."managed:kimi-code"');
  const oauth = sections.get('providers."managed:kimi-code".oauth');
  return {
    baseUrl: stringValue(provider, "base_url") ?? stringValue(provider, "baseUrl"),
    oauthHost: stringValue(oauth, "oauth_host") ?? stringValue(oauth, "oauthHost"),
    key: stringValue(oauth, "key"),
    storage: stringValue(oauth, "storage"),
    region: region.trim() || null,
  };
}

/** The CLI names the file after its slot: `oauth/kimi-code-env-<id>` → `kimi-code-env-<id>.json`. */
export function fileNameFromKey(key: string): string | null {
  const name = key
    .replace(/^oauth\//, "")
    .split("/")
    .pop()
    ?.trim();
  if (!name || name.includes("..") || name.includes("\\")) return null;
  return `${name}.json`;
}

export async function credentialPaths(config: KimiConfig): Promise<string[]> {
  const directory = join(kimiHome(), "credentials");
  if (config.key) {
    const name = fileNameFromKey(config.key);
    if (!name) throw new Error(UNAVAILABLE);
    return [join(directory, name)];
  }
  let names: string[];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const entries = await Promise.all(
    names.map(async (name) => {
      const path = join(directory, name);
      const info = await stat(path).catch(() => null);
      return { path, name, mtime: info?.mtimeMs ?? 0 };
    }),
  );
  entries.sort((a, b) => {
    const aDefault = a.name === "kimi-code.json";
    const bDefault = b.name === "kimi-code.json";
    if (aDefault !== bDefault) return aDefault ? -1 : 1;
    return b.mtime - a.mtime;
  });
  return entries.map((entry) => entry.path);
}

/** The auth host travels with the credential; callers keep the resolved value on each read. */
export { resolveOAuthHost };
