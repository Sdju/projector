import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
const ALGORITHM = "aes-256-gcm";
const COMPANION = "ai-companion/openai-provider-keys/v1";
const PROJECTOR = "projector/openai-provider-keys/v1";
const SOURCE = "/run/media/zede/general/pr/playground/fortth-new/ai-companion/data/providers.json";
const TARGET = join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share"), "projector", "providers.json");

function deriveKey(secret) {
  return createHash("sha256").update(secret).digest();
}

function reveal(value, secret) {
  const payload = value.slice(PREFIX.length);
  const [ivPart, tagPart, dataPart] = payload.split(".");
  const decipher = createDecipheriv(ALGORITHM, deriveKey(secret), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function obfuscate(plain, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

const source = JSON.parse(readFileSync(SOURCE, "utf8"));
const providers = [];

for (const item of source.providers ?? []) {
  const next = {
    id: item.id,
    name: item.name,
    url: item.url,
    model: item.model,
    apiKey: "",
  };
  if (typeof item.apiKey === "string" && item.apiKey.startsWith(PREFIX)) {
    const plain = reveal(item.apiKey, COMPANION);
    next.apiKey = obfuscate(plain, PROJECTOR);
    console.log(`перенесён ключ: ${item.name} (${plain.length} символов)`);
  }
  providers.push(next);
}

const active =
  providers.some((item) => item.id === source.activeProviderId)
    ? source.activeProviderId
    : (providers.find((item) => item.apiKey)?.id ?? providers[0]?.id ?? null);

mkdirSync(dirname(TARGET), { recursive: true });
writeFileSync(TARGET, `${JSON.stringify({ activeProviderId: active, providers }, null, 2)}\n`);
console.log(`записано: ${TARGET}`);
