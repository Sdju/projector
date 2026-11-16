import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const TOKEN = /^[a-f0-9]{64}$/;
const GRACE = 30_000;
const TTL = 30 * 24 * 60 * 60 * 1000;
const LIMIT = 32;

export function hubDataDir(): string {
  if (process.env.PROJECTOR_HUB_DATA) return process.env.PROJECTOR_HUB_DATA;
  if (process.env.XDG_DATA_HOME) return join(process.env.XDG_DATA_HOME, "projector-hub");
  return join(homedir(), ".local/share", "projector-hub");
}

interface IssuedRefresh {
  token: string;
  family: string;
}

interface Record {
  family: string;
  id: string;
  expires: number;
  previous?: string;
  previousUntil?: number;
}

/** Hashed refresh tokens on disk; plaintext exists only for the rotation grace window. */
export class RefreshStore {
  private records: Record[] = [];
  private grace = new Map<string, { token: string; family: string; until: number }>();
  private readonly file: string;
  private readonly password: string;
  constructor(file: string, password: string) {
    this.file = file;
    this.password = password;
    this.load();
  }

  issue(family = randomBytes(16).toString("hex")): IssuedRefresh {
    this.prune();
    this.records = this.records.filter((item) => item.family !== family);
    if (this.records.length >= LIMIT) {
      let oldest = 0;
      for (let i = 1; i < this.records.length; i++)
        if (this.records[i]!.expires < this.records[oldest]!.expires) oldest = i;
      this.records.splice(oldest, 1);
    }
    const token = randomBytes(32).toString("hex");
    this.records.push({ family, id: digest(token), expires: Date.now() + TTL });
    this.persist();
    return { token, family };
  }

  consume(token: string): IssuedRefresh | undefined {
    if (!TOKEN.test(token)) return undefined;
    this.prune();
    const id = digest(token);
    const replay = this.grace.get(id);
    if (replay && replay.until > Date.now()) return { token: replay.token, family: replay.family };
    const record = this.records.find((item) => item.id === id || item.previous === id);
    if (!record || record.expires <= Date.now()) return undefined;
    if (record.previous === id && (record.previousUntil ?? 0) <= Date.now()) {
      this.revoke(record.family);
      return undefined;
    }
    const next = randomBytes(32).toString("hex");
    const previous = record.id;
    const previousUntil = Date.now() + GRACE;
    record.previous = previous;
    record.previousUntil = previousUntil;
    record.id = digest(next);
    record.expires = Date.now() + TTL;
    this.grace.set(previous, { token: next, family: record.family, until: previousUntil });
    this.persist();
    return { token: next, family: record.family };
  }

  revoke(tokenOrFamily: string): void {
    const id = TOKEN.test(tokenOrFamily) ? digest(tokenOrFamily) : "";
    const family = this.records.find(
      (item) => item.family === tokenOrFamily || item.id === id || item.previous === id,
    )?.family;
    if (!family) return;
    this.records = this.records.filter((item) => item.family !== family);
    for (const [key, value] of this.grace) if (value.family === family) this.grace.delete(key);
    this.persist();
  }

  private prune(): void {
    const now = Date.now();
    this.records = this.records.filter((item) => item.expires > now);
    for (const [key, value] of this.grace) if (value.until <= now) this.grace.delete(key);
  }

  private load(): void {
    try {
      const stored = JSON.parse(readFileSync(this.file, "utf8")) as {
        password?: unknown;
        tokens?: unknown;
      };
      if (stored.password !== this.password) {
        this.records = [];
        this.persist();
        return;
      }
      if (!Array.isArray(stored.tokens)) return;
      const now = Date.now();
      this.records = stored.tokens.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const { family, id, expires, previous, previousUntil } = item as Record;
        if (
          typeof family !== "string" ||
          typeof id !== "string" ||
          typeof expires !== "number" ||
          expires <= now
        )
          return [];
        return [
          {
            family,
            id,
            expires,
            previous: typeof previous === "string" ? previous : undefined,
            previousUntil: typeof previousUntil === "number" ? previousUntil : undefined,
          },
        ];
      });
    } catch {
      this.records = [];
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      writeFileSync(temporary, JSON.stringify({ password: this.password, tokens: this.records }), {
        mode: 0o600,
      });
      chmodSync(temporary, 0o600);
      renameSync(temporary, this.file);
    } catch {
      // Login still works from memory until the next restart.
    }
  }
}
