import { createHash, timingSafeEqual } from "node:crypto";
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
}

const hash = (key: string) => createHash("sha256").update(key).digest("hex");

function readConfig(): GatewayConfig {
  try {
    const parsed = JSON.parse(readFileSync(gatewayConfigPath(), "utf8")) as Record<string, unknown>;
    return {
      enabled: parsed.enabled === true,
      keyHash: typeof parsed.keyHash === "string" && parsed.keyHash ? parsed.keyHash : null,
    };
  } catch {
    return { enabled: false, keyHash: null };
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
