import { createHash, timingSafeEqual } from "node:crypto";
import { BlockList, isIP } from "node:net";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../../../core/modules/app-paths/index.ts";

export function gatewayConfigPath(): string {
  return join(dataDir(), "openai-gateway.json");
}

interface GatewayConfig {
  enabled: boolean;
  /** SHA-256 of the access key; the key itself is never stored. */
  keyHash: string | null;
  /** Origins of browser pages allowed to call the gateway; empty means none. */
  origins: string[];
}

const MAX_ORIGINS = 50;

/** Templates stored beside exact origins: any page of this machine / of the local network, any port. */
export const ORIGIN_TEMPLATES = ["@localhost", "@lan"] as const;

const loopback = new BlockList();
loopback.addSubnet("127.0.0.0", 8, "ipv4");
loopback.addAddress("::1", "ipv6");
const privateNetworks = new BlockList();
for (const [net, prefix] of [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["169.254.0.0", 16],
] as const)
  privateNetworks.addSubnet(net, prefix, "ipv4");
privateNetworks.addSubnet("fc00::", 7, "ipv6");
privateNetworks.addSubnet("fe80::", 10, "ipv6");

function inList(list: BlockList, host: string): boolean {
  const family = isIP(host);
  return family !== 0 && list.check(host, family === 6 ? "ipv6" : "ipv4");
}

/** Whether the origin's host is this machine (`@localhost`) or a private network address (`@lan`). */
function matchesTemplate(origin: string, template: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return false;
  }
  if (template === "@localhost")
    return host === "localhost" || host.endsWith(".localhost") || inList(loopback, host);
  if (template === "@lan") return host.endsWith(".local") || inList(privateNetworks, host);
  return false;
}

/** `https://app.example.com/x` → `https://app.example.com`; anything but http(s) is dropped. */
export function normalizeOrigins(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const origins = new Set<string>();
  for (const item of list) {
    if (typeof item !== "string") continue;
    const template = item.trim().toLowerCase();
    if ((ORIGIN_TEMPLATES as readonly string[]).includes(template)) {
      origins.add(template);
      continue;
    }
    try {
      const url = new URL(item.trim());
      if (url.protocol === "http:" || url.protocol === "https:") origins.add(url.origin);
    } catch {
      // Not a URL: skipped.
    }
  }
  return [...origins].slice(0, MAX_ORIGINS);
}

const hash = (key: string) => createHash("sha256").update(key).digest("hex");

function readConfig(): GatewayConfig {
  try {
    const parsed = JSON.parse(readFileSync(gatewayConfigPath(), "utf8")) as Record<string, unknown>;
    return {
      enabled: parsed.enabled === true,
      keyHash: typeof parsed.keyHash === "string" && parsed.keyHash ? parsed.keyHash : null,
      origins: normalizeOrigins(parsed.origins),
    };
  } catch {
    return { enabled: false, keyHash: null, origins: [] };
  }
}

function writeConfig(config: GatewayConfig): void {
  const file = gatewayConfigPath();
  mkdirSync(dataDir(), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(config)}\n`, { mode: 0o600 });
  renameSync(temporary, file);
}

/** The gateway spends the user's provider quota, so it is off until switched on. */
export function gatewayEnabled(): boolean {
  return readConfig().enabled;
}

export function gatewayHasKey(): boolean {
  return readConfig().keyHash !== null;
}

export function setGatewayEnabled(enabled: boolean): void {
  writeConfig({ ...readConfig(), enabled });
}

export function gatewayOrigins(): string[] {
  return readConfig().origins;
}

/** Invalid entries are dropped; returns the list actually stored. */
export function setGatewayOrigins(origins: unknown): string[] {
  const list = normalizeOrigins(origins);
  writeConfig({ ...readConfig(), origins: list });
  return list;
}

export function gatewayOriginAllowed(origin: string): boolean {
  const { origins } = readConfig();
  return origins.includes(origin) || origins.some((entry) => matchesTemplate(origin, entry));
}

/** An empty key removes the requirement. */
export function setGatewayKey(key: string): void {
  writeConfig({ ...readConfig(), keyHash: key ? hash(key) : null });
}

/** `null` when no key is configured, otherwise whether the request carries it as a Bearer token. */
export function checkGatewayKey(authorization: string | undefined): boolean | null {
  const { keyHash } = readConfig();
  if (!keyHash) return null;
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const candidate = Buffer.from(hash(token), "hex");
  const expected = Buffer.from(keyHash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
