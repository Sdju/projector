import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { dirname } from "node:path";
import { lanPasswordPath } from "../../../core/modules/app-paths/index.ts";

interface Stored {
  salt: Buffer;
  hash: Buffer;
}

function readStored(): Stored | null {
  try {
    const [salt, hash] = readFileSync(lanPasswordPath(), "utf8").trim().split(":");
    if (!salt || !hash) return null;
    return { salt: Buffer.from(salt, "hex"), hash: Buffer.from(hash, "hex") };
  } catch {
    return null;
  }
}

export function hasLanPassword(): boolean {
  return readStored() !== null;
}

export function verifyLanPassword(password: string): boolean {
  const stored = readStored();
  if (!stored) return false;
  const candidate = scryptSync(password, stored.salt, stored.hash.length);
  return timingSafeEqual(candidate, stored.hash);
}

export function setLanPassword(password: string): void {
  mkdirSync(dirname(lanPasswordPath()), { recursive: true });
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  writeFileSync(lanPasswordPath(), `${salt.toString("hex")}:${hash.toString("hex")}\n`, {
    mode: 0o600,
  });
}

export function clearLanPassword(): void {
  rmSync(lanPasswordPath(), { force: true });
}
