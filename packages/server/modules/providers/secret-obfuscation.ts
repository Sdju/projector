import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
const ALGORITHM = "aes-256-gcm";

export const DEFAULT_PROVIDERS_SECRET = "projector/openai-provider-keys/v1";
export const LEGACY_PROVIDER_SECRETS = ["ai-companion/openai-provider-keys/v1"];

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function obfuscateSecret(plain: string, secret = DEFAULT_PROVIDERS_SECRET): string {
  const trimmed = plain.trim();
  if (!trimmed) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(trimmed, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function revealWithSecret(value: string, secret: string): string {
  const payload = value.slice(PREFIX.length);
  const [ivPart, tagPart, dataPart] = payload.split(".");
  if (!ivPart || !tagPart || !dataPart) throw new Error("Invalid obfuscated secret");
  const decipher = createDecipheriv(ALGORITHM, deriveKey(secret), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function revealSecret(value: string, secret = DEFAULT_PROVIDERS_SECRET): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!trimmed.startsWith(PREFIX)) return trimmed;
  const secrets = [secret, ...LEGACY_PROVIDER_SECRETS.filter((item) => item !== secret)];
  let lastError: unknown;
  for (const candidate of secrets) {
    try {
      return revealWithSecret(trimmed, candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Invalid obfuscated secret");
}
