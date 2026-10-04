import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { dirname } from "node:path";
import { lanPasswordPath } from "../../../core/modules/app-paths/index.ts";

interface Stored {
  salt: Buffer;
  hash: Buffer;
}

const state = globalThis as typeof globalThis & { projectorLanPasswordListeners?: Set<() => void> };
const listeners = (state.projectorLanPasswordListeners ??= new Set());

export function onLanPasswordChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function passwordChanged(): void {
  for (const listener of listeners) listener();
}

function readStored(): Stored | null {
  try {
    const raw = readFileSync(lanPasswordPath(), "utf8").trim();
    if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(raw)) throw new Error("Повреждён файл пароля LAN");
    const [salt, hash] = raw.split(":");
    return { salt: Buffer.from(salt, "hex"), hash: Buffer.from(hash, "hex") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Changes on every password replacement, including replacement with the same password. */
export function lanPasswordVersion(): string | null {
  return readStored()?.hash.toString("hex") ?? null;
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
  const file = lanPasswordPath();
  const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    writeFileSync(temporary, `${salt.toString("hex")}:${hash.toString("hex")}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, file);
    passwordChanged();
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function clearLanPassword(): void {
  rmSync(lanPasswordPath(), { force: true });
  passwordChanged();
}
