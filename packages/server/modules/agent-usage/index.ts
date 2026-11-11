import { os } from "@ai-projector/core/modules/os/index.ts";
import type {
  AgentUsage,
  AgentUsageWindow,
} from "@ai-projector/core/modules/usage-analytics/index.ts";
import { agentUsageProvider, type AgentUsageProvider } from "../agent/index.ts";
import { usageWindowsOf } from "../usage-analytics/index.ts";

const CACHE_MS = 60_000;
const FAILURE_MS = 15_000;
const MAX_OUTPUT = 1_000_000;
const cache = new Map<string, { at: number; value: AgentUsage }>();

/** Drops cached limits; tests use it, HMR loses the map with the module anyway. */
export function resetAgentUsageCache(): void {
  cache.clear();
}

interface Payload {
  [key: string]: unknown;
}

const asRecord = (value: unknown): Payload | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Payload) : null;

function unavailable(checkedAt: number, message: string): AgentUsage {
  return { status: "unavailable", windows: null, checkedAt, message };
}

function normalize(value: unknown, checkedAt: number): AgentUsage {
  const payload = asRecord(value);
  if (!payload) return unavailable(checkedAt, "Провайдер лимитов вернул не JSON-объект");
  const requested = payload.status === "unavailable";
  const windows =
    requested || (!payload.windows && !payload.weekly)
      ? new Map()
      : usageWindowsOf({ ...payload, status: "ready" });
  if (!windows.size)
    return {
      ...unavailable(checkedAt, "Лимиты недоступны"),
      ...(typeof payload.message === "string" && payload.message
        ? { message: payload.message }
        : {}),
    };
  const result: Record<string, AgentUsageWindow> = {};
  for (const [name, window] of windows)
    if (window)
      result[name] = {
        usedPercent: window.used,
        resetsAt: window.resetsAt,
        limited: window.limited,
      };
  return {
    status: "ready",
    windows: result,
    checkedAt:
      typeof payload.checkedAt === "number" && Number.isFinite(payload.checkedAt)
        ? payload.checkedAt
        : checkedAt,
    ...(typeof payload.message === "string" && payload.message ? { message: payload.message } : {}),
  };
}

function run(provider: AgentUsageProvider, checkedAt: number): Promise<AgentUsage> {
  return new Promise((resolve) => {
    let output = "";
    let error = "";
    let settled = false;
    const finish = (value: AgentUsage) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        /* The process is already gone. */
      }
      resolve(value);
    };
    const timer = setTimeout(
      () => finish(unavailable(checkedAt, "Провайдер лимитов не ответил вовремя")),
      provider.timeoutMs ?? 10_000,
    );
    let child: ReturnType<typeof os.tools.spawnProcess>;
    try {
      child = os.tools.spawnProcess({
        command: provider.command,
        args: provider.args ?? [],
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
    } catch (reason) {
      clearTimeout(timer);
      resolve(
        unavailable(checkedAt, reason instanceof Error ? reason.message : "Команда не запустилась"),
      );
      return;
    }
    child.stdout?.on("data", (chunk: Buffer | string) => {
      output += chunk.toString();
      if (output.length > MAX_OUTPUT)
        finish(unavailable(checkedAt, "Провайдер лимитов вернул слишком много"));
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      error = `${error}${chunk.toString()}`.slice(-10_000);
    });
    child.on("error", (reason) => finish(unavailable(checkedAt, reason.message)));
    child.on("close", (code) => {
      if (code !== 0) {
        finish(
          unavailable(checkedAt, error.trim() || `Провайдер лимитов завершился с кодом ${code}`),
        );
        return;
      }
      try {
        finish(normalize(JSON.parse(output) as unknown, checkedAt));
      } catch {
        finish(unavailable(checkedAt, "Провайдер лимитов вернул некорректный JSON"));
      }
    });
  });
}

/** Limits of a plugin agent; `usage.command` runs as an argv process, never through a shell. */
export async function readAgentUsageLimits(id: string, now = Date.now()): Promise<AgentUsage> {
  const provider = agentUsageProvider(id);
  if (!provider) return unavailable(now, "Агент не сообщает лимиты");
  const cached = cache.get(id);
  if (cached && now - cached.at < (cached.value.status === "ready" ? CACHE_MS : FAILURE_MS))
    return cached.value;
  const value = await run(provider, now);
  cache.set(id, { at: now, value });
  return value;
}
