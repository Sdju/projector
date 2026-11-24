import { stripVTControlCharacters } from "node:util";
import type {
  AntigravityUsage,
  AntigravityUsageWindow,
  AntigravityUsageWindowName,
} from "@ai-projector/core/modules/agents-integration/antigravity/index.ts";
import { os } from "@ai-projector/core/modules/os/index.ts";
import { agentEnv } from "../../agent/index.ts";
import { acpTerminalExecutable, launchOverride, mergeLaunchEnv } from "../acp/index.ts";

const TIMEOUT_MS = 45_000;
const MAX_OUTPUT_BYTES = 512 * 1024;
const IDLE_MESSAGE = 'Нажмите «Обновить» для проверки лимитов через agy -p "/usage"';
const QUOTA_LINE =
  /^(.+?)\s+(Weekly|Five\s+Hour|5[- ]?Hour)\s+Limit\s+Remaining\s+(\d+(?:\.\d+)?)%(?:\s+(.+))?$/i;
const CLI_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?\s*(Z|UTC|[+-]\d{2}(?::?\d{2})?)$/i;

const recordOf = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** Parses `agy -p "/usage"` timestamps (`2026-12-01T14:44:02Z`, `2026-12-01 19:44 +05`); epoch 0 becomes `null`. */
export function parseAntigravityResetTime(raw: string | undefined): number | null {
  const value = raw?.trim();
  if (!value) return null;
  const match = CLI_TIMESTAMP.exec(value);
  let iso = value;
  if (match) {
    const [, date, hm, sec = "00", zone] = match;
    let offset = zone!.toUpperCase();
    if (offset === "UTC") offset = "Z";
    else if (/^[+-]\d{2}$/.test(offset)) offset = `${offset}:00`;
    else if (/^[+-]\d{4}$/.test(offset)) offset = `${offset.slice(0, 3)}:${offset.slice(3)}`;
    iso = `${date}T${hm}:${sec}${offset}`;
  }
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed / 1000);
}

function windowNameFromBucket(id: string, window: string): AntigravityUsageWindowName | null {
  const weekly = window === "weekly";
  const session = window === "5h";
  if (!weekly && !session) return null;
  if (id.startsWith("gemini-")) return weekly ? "geminiWeekly" : "geminiRolling";
  if (id.startsWith("3p-")) return weekly ? "thirdPartyWeekly" : "thirdPartyRolling";
  return null;
}

function windowNameOf(group: string, period: string): AntigravityUsageWindowName | null {
  const normalizedGroup = group.trim().toLowerCase();
  const weekly = period.trim().toLowerCase().startsWith("week");
  if (normalizedGroup.includes("gemini")) return weekly ? "geminiWeekly" : "geminiRolling";
  if (
    normalizedGroup.includes("claude") ||
    normalizedGroup.includes("gpt") ||
    normalizedGroup.includes("3p") ||
    normalizedGroup.includes("third")
  )
    return weekly ? "thirdPartyWeekly" : "thirdPartyRolling";
  return null;
}

function parseStructuredUsage(payload: unknown): AntigravityUsage["windows"] {
  const root = recordOf(payload);
  const data = recordOf(recordOf(root?.command)?.data) ?? root;
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  const top = Array.isArray(data?.buckets) ? data.buckets : [];
  const buckets: unknown[] = [];
  for (const group of groups) {
    const entry = recordOf(group);
    if (Array.isArray(entry?.buckets)) buckets.push(...entry.buckets);
  }
  buckets.push(...top);
  const result: Partial<Record<AntigravityUsageWindowName, AntigravityUsageWindow>> = {};
  for (const item of buckets) {
    const bucket = recordOf(item);
    if (!bucket || bucket.disabled === true) continue;
    const id = typeof bucket.id === "string" ? bucket.id : "";
    const window = typeof bucket.window === "string" ? bucket.window : "";
    const name = windowNameFromBucket(id, window);
    if (!name) continue;
    const remaining = bucket.remaining_fraction;
    if (typeof remaining !== "number" || !Number.isFinite(remaining)) continue;
    const clamped = Math.max(0, Math.min(1, remaining));
    const entry: AntigravityUsageWindow = {
      usedPercent: Math.round((1 - clamped) * 10_000) / 100,
      resetsAt: parseAntigravityResetTime(
        typeof bucket.reset_time === "string" ? bucket.reset_time : undefined,
      ),
      limited: clamped <= 0,
    };
    const previous = result[name];
    if (!previous || entry.usedPercent > previous.usedPercent) result[name] = entry;
  }
  return Object.keys(result).length ? result : null;
}

function parsePlainUsage(output: string): AntigravityUsage["windows"] {
  const clean = stripVTControlCharacters(output);
  const result: Partial<Record<AntigravityUsageWindowName, AntigravityUsageWindow>> = {};
  for (const rawLine of clean.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = QUOTA_LINE.exec(line);
    if (!match) continue;
    const [, group, period, percentText, resetText] = match;
    const name = windowNameOf(group!, period!);
    if (!name) continue;
    const remaining = Number(percentText);
    if (!Number.isFinite(remaining)) continue;
    const clamped = Math.max(0, Math.min(100, remaining));
    const entry: AntigravityUsageWindow = {
      usedPercent: Math.round((100 - clamped) * 100) / 100,
      resetsAt: parseAntigravityResetTime(resetText),
      limited: clamped <= 0,
    };
    const previous = result[name];
    if (!previous || entry.usedPercent > previous.usedPercent) result[name] = entry;
  }
  return Object.keys(result).length ? result : null;
}

/** Parses JSON (or plain-text fallback) stdout produced by `agy -p "/usage" --output-format json`. */
export function parseAntigravityCliUsage(output: string): AntigravityUsage["windows"] {
  const trimmed = output.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const structured = parseStructuredUsage(parsed);
      if (structured) return structured;
      const root = recordOf(parsed);
      if (typeof root?.response === "string") return parsePlainUsage(root.response);
    } catch {
      // Fall through to plain-text parsing if stdout was not JSON.
    }
  }
  return parsePlainUsage(output);
}

function scrubApiKeys(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const cleaned: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    const upper = process.platform === "win32" ? key.toUpperCase() : key;
    if (upper === "GEMINI_API_KEY" || upper === "GOOGLE_API_KEY") continue;
    cleaned[key] = value;
  }
  return cleaned;
}

/** Runs the official `agy -p "/usage" --output-format json` command once with bounded timeout and output cap. */
export async function runAntigravityUsageCommand(timeoutMs = TIMEOUT_MS): Promise<string> {
  const override = launchOverride("antigravity");
  const baseEnv = scrubApiKeys(await os.tools.agentEnv(agentEnv()));
  const env = mergeLaunchEnv(baseEnv, override?.env);
  const command = acpTerminalExecutable("antigravity", "agy");

  return new Promise((resolve, reject) => {
    const child = os.tools.spawnProcess({
      command,
      args: ["-p", "/usage", "--output-format", "json"],
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: os.platform === "win32" && !command.includes("/") && !command.includes("\\"),
    });
    if (!child.stdout || !child.stderr) {
      child.kill();
      reject(new Error("Antigravity CLI (agy) недоступен"));
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error, text?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill();
        const killTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
        killTimer.unref();
        child.once("close", () => clearTimeout(killTimer));
        reject(error);
      } else {
        resolve(text ?? "");
      }
    };
    const timer = setTimeout(
      () => finish(new Error('agy -p "/usage" не ответил вовремя')),
      timeoutMs,
    );
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT_BYTES)
        finish(new Error('Ответ agy -p "/usage" слишком большой'));
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") finish(new Error("Antigravity CLI (agy) не найден в PATH"));
      else finish(new Error(`Antigravity CLI недоступен: ${error.message}`));
    });
    child.once("close", (code) => {
      if (code === 0) {
        finish(undefined, stdout);
        return;
      }
      const tail = (stderr.trim() || stdout.trim()).split(/\r?\n/).at(-1);
      finish(
        new Error(
          tail
            ? `agy -p "/usage" завершился с ошибкой: ${tail}`
            : `agy -p "/usage" завершился с кодом ${code ?? "unknown"}`,
        ),
      );
    });
  });
}

const globalState = globalThis as typeof globalThis & {
  projectorAntigravityUsage?: { value?: AntigravityUsage; pending?: Promise<AntigravityUsage> };
};
const state = (globalState.projectorAntigravityUsage ??= {});

/** Returns only the last manually measured snapshot without ever spawning `agy`. */
export function cachedAntigravityUsage(): AntigravityUsage {
  return (
    state.value ?? {
      status: "idle",
      windows: null,
      checkedAt: 0,
      message: IDLE_MESSAGE,
    }
  );
}

/** Explicit manual refresh via official `agy -p "/usage"` (deduped while in flight). */
export function refreshAntigravityUsage(
  runner: () => Promise<string> = () => runAntigravityUsageCommand(),
): Promise<AntigravityUsage> {
  if (state.pending) return state.pending;
  state.pending = Promise.resolve()
    .then(async (): Promise<AntigravityUsage> => {
      try {
        const windows = parseAntigravityCliUsage(await runner());
        return {
          status: windows ? "ready" : "unavailable",
          windows,
          checkedAt: Date.now(),
          message: windows ? null : 'Не удалось разобрать ответ agy -p "/usage"',
        };
      } catch (error) {
        return {
          status: "unavailable",
          windows: null,
          checkedAt: Date.now(),
          message: error instanceof Error ? error.message : "Antigravity CLI недоступен",
        };
      }
    })
    .then((value) => {
      state.value = value;
      return value;
    })
    .finally(() => {
      state.pending = undefined;
    });
  return state.pending;
}

/** Test helper: clears cached in-memory quota snapshot. */
export function resetAntigravityUsageCache(): void {
  state.value = undefined;
  state.pending = undefined;
}
