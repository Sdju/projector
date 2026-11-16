import { os } from "@ai-projector/core/modules/os/index.ts";
import type {
  ProviderUsage,
  ProviderUsageContext,
  ProviderUsageQuota,
  ProviderUsageResolver,
} from "../providers/index.ts";

type Dict = Record<string, unknown>;

const record = (value: unknown): Dict | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : null;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const amount = (value: unknown): string | null => {
  const valueText =
    typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  return /^\d+(?:\.\d+)?$/.test(valueText) ? valueText : null;
};

const percent = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;

const credits = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

/** Разбирает два JSON-ответа CLI: `usage summary` и `billing summary`. */
export function parseQwenCloudUsage(
  usagePayload: unknown,
  billingPayload: unknown,
): Omit<ProviderUsage, "status" | "checkedAt" | "message"> {
  const usage = record(usagePayload) ?? {};
  const usagePeriod = record(usage.period);
  const billing = record(billingPayload) ?? {};
  const billingPeriod = record(billing.period);
  const payg = record(usage.pay_as_you_go);
  const paygTotal = record(payg?.total);
  const totals = record(billing.totals);
  const quotas = Array.isArray(usage.free_tier)
    ? usage.free_tier.flatMap((item): ProviderUsageQuota[] => {
        const model = record(item);
        if (!model) return [];
        const quota = record(model.quota);
        const total = amount(quota?.total);
        const remaining = amount(quota?.remaining);
        const totalNumber = total ? Number(total) : 0;
        return [
          {
            modelId: text(model.model_id) || text(model.modelId),
            remaining,
            total,
            unit: text(quota?.unit) || null,
            percent:
              totalNumber > 0 && remaining
                ? percent(Number(((Number(remaining) / totalNumber) * 100).toFixed(2)))
                : null,
            status: text(quota?.status) || null,
          },
        ];
      })
    : [];
  const coding = record(usage.coding_plan);
  const tokenPlan = record(usage.token_plan);
  const totalCredits = credits(tokenPlan?.totalCredits);
  const remainingCredits = credits(tokenPlan?.remainingCredits);
  const periodFrom = text(billingPeriod?.from) || text(usagePeriod?.from);
  const periodTo = text(billingPeriod?.to) || text(usagePeriod?.to);
  return {
    period: periodFrom || periodTo ? { from: periodFrom, to: periodTo } : null,
    currency: text(billing.currency) || text(paygTotal?.currency) || null,
    spend: amount(totals?.aftertaxAmount) ?? amount(paygTotal?.cost),
    quotas,
    plan: text(coding?.plan) || text(tokenPlan?.plan) || null,
    credits:
      totalCredits !== null && remainingCredits !== null
        ? { total: totalCredits, remaining: remainingCredits }
        : null,
  };
}

export type QwenCloudCliRunner = (args: string[], signal?: AbortSignal) => Promise<unknown>;

const MAX_CLI_OUTPUT = 4 * 1024 * 1024;

function runCli(args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof os.tools.spawnProcess>;
    try {
      child = os.tools.spawnProcess({
        command: "qwencloud",
        args,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        shell: os.platform === "win32" && os.tools.commandExists("qwencloud"),
      });
    } catch (error) {
      reject(error);
      return;
    }
    let output = "";
    let settled = false;
    const finish = (error?: Error, stdout?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) {
        child.kill();
        reject(error);
      } else resolve(stdout ?? "");
    };
    const abort = (): void => {
      finish(Object.assign(new Error("Чтение QwenCloud CLI отменено"), { code: "ABORT_ERR" }));
    };
    const timer = setTimeout(() => {
      finish(Object.assign(new Error("QwenCloud CLI не ответил вовремя"), { code: "ETIMEDOUT" }));
    }, 20000);
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      output += chunk;
      if (output.length > MAX_CLI_OUTPUT)
        finish(
          Object.assign(new Error("Ответ QwenCloud CLI слишком большой"), { code: "EMSGSIZE" }),
        );
    });
    child.stderr?.resume();
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      if (code === 0) finish(undefined, output);
      else
        finish(
          Object.assign(new Error(`QwenCloud CLI завершился с кодом ${code ?? 1}`), {
            code: code ?? 1,
          }),
        );
    });
  });
}

const defaultRunner: QwenCloudCliRunner = async (args, signal) =>
  JSON.parse(await runCli(args, signal)) as unknown;

function cliFailure(error: unknown): string {
  const code = record(error)?.code;
  if (code === "ENOENT") return "CLI qwencloud не установлен";
  if (code === 2) return "QwenCloud CLI требует вход: qwencloud auth login";
  if (code === 3) return "QwenCloud CLI не смог подключиться к сети";
  return "Не удалось прочитать расход через QwenCloud CLI";
}

const READY_TTL_MS = 60000;
const FAILED_TTL_MS = 15000;

const globalState = globalThis as typeof globalThis & {
  projectorProviderUsage?: Map<string, { value?: ProviderUsage; pending?: Promise<ProviderUsage> }>;
};
const cache = (): Map<string, { value?: ProviderUsage; pending?: Promise<ProviderUsage> }> =>
  (globalState.projectorProviderUsage ??= new Map());

async function read(
  context: ProviderUsageContext,
  runner: QwenCloudCliRunner,
): Promise<ProviderUsage> {
  const checkedAt = Date.now();
  const [usage, billing] = await Promise.allSettled([
    runner(["usage", "summary", "--format", "json"], context.signal),
    runner(["billing", "summary", "--format", "json"], context.signal),
  ]);
  const errors: string[] = [];
  if (usage.status === "rejected") errors.push(cliFailure(usage.reason));
  if (billing.status === "rejected") errors.push(cliFailure(billing.reason));
  const usagePayload = usage.status === "fulfilled" ? usage.value : null;
  const billingPayload = billing.status === "fulfilled" ? billing.value : null;
  if (usagePayload === null && billingPayload === null)
    return {
      status: "unavailable",
      period: null,
      currency: null,
      spend: null,
      quotas: [],
      plan: null,
      credits: null,
      checkedAt,
      message: errors[0] ?? "Не удалось прочитать расход QwenCloud",
    };
  const parsed = parseQwenCloudUsage(usagePayload, billingPayload);
  return {
    status: "ready",
    ...parsed,
    checkedAt,
    message: errors.length ? errors[0] : null,
  };
}

/** Расход и квоты QwenCloud из CLI; кошелёк (available balance) CLI не отдаёт. */
export async function readQwenCloudUsage(
  context: ProviderUsageContext,
  runner: QwenCloudCliRunner = defaultRunner,
): Promise<ProviderUsage> {
  const key = context.id;
  const entry = cache().get(key) ?? {};
  if (!cache().has(key) && cache().size >= 16)
    cache().delete(cache().keys().next().value as string);
  cache().set(key, entry);
  if (entry.pending) return entry.pending;
  const ttl = entry.value?.status === "ready" ? READY_TTL_MS : FAILED_TTL_MS;
  if (entry.value && Date.now() < entry.value.checkedAt + ttl) return entry.value;
  entry.pending = read(context, runner)
    .then((value) => {
      entry.value = value;
      return value;
    })
    .finally(() => {
      entry.pending = undefined;
    });
  return entry.pending;
}

export function resetQwenCloudUsageCache(): void {
  cache().clear();
}

export const qwencloudUsageResolver: ProviderUsageResolver = {
  kind: "qwencloud",
  title: "QwenCloud CLI",
  description: "Расход, бесплатные квоты, план и кредиты из CLI qwencloud.",
  read: (context) => readQwenCloudUsage(context),
};
