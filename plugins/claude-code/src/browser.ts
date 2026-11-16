import {
  definePlugin,
  type AgentPlanItem,
  type AgentUsageTone,
  type PluginApi,
} from "@ai-projector/plugin-api";
import { claudeToolMeta } from "./tools.ts";

const PLAN_STATUS: Record<string, AgentPlanItem["status"]> = {
  pending: "pending",
  in_progress: "in_progress",
  completed: "completed",
  done: "completed",
};

const WINDOWS = [
  { name: "weekly", label: "Неделя", shortLabel: "нед", periodSeconds: 7 * 86400 },
  { name: "rolling", label: "5 часов", shortLabel: "5ч", periodSeconds: 5 * 3600 },
] as const;

type WindowName = (typeof WINDOWS)[number]["name"];

interface UsageWindow {
  usedPercent: number;
  resetsAt?: number | null;
  limited?: boolean;
}

interface UsagePayload {
  status?: string;
  message?: string | null;
  windows?: Partial<Record<WindowName, UsageWindow | null>> | null;
}

/** The command cycles whichever indicator is currently mounted. */
let cycleWindow: (() => void) | undefined;

function parseInput(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function plan(call: { name: string; input?: string }): AgentPlanItem[] | undefined {
  if (call.name !== "TodoWrite" || !call.input) return undefined;
  const value = parseInput(call.input);
  const todos =
    value && typeof value === "object" ? (value as { todos?: unknown }).todos : undefined;
  if (!Array.isArray(todos)) return undefined;
  return todos.flatMap((item): AgentPlanItem[] => {
    if (!item || typeof item !== "object") return [];
    const { content, title, status, activeForm } = item as Record<string, unknown>;
    const text = typeof content === "string" ? content : typeof title === "string" ? title : "";
    const state = typeof status === "string" ? PLAN_STATUS[status] : undefined;
    if (!text.trim() || !state) return [];
    return [
      {
        content: text,
        status: state,
        ...(typeof activeForm === "string" ? { active: activeForm } : {}),
      },
    ];
  });
}

function toolLabel(call: { name: string; input?: string }): string | undefined {
  return claudeToolMeta(call.name, parseInput(call.input)).label;
}

function remainingOf(window: UsageWindow): number {
  return Math.round(100 - window.usedPercent);
}

function remainingTone(remaining: number): AgentUsageTone {
  if (remaining <= 0) return "over";
  if (remaining <= 20) return "hot";
  if (remaining <= 50) return "normal";
  return "spare";
}

/** Pace of spend vs time left; falls back to remaining when the reset is unknown. */
function windowTone(window: UsageWindow, periodSeconds: number, now: number): AgentUsageTone {
  const remaining = remainingOf(window);
  if (window.limited || window.usedPercent >= 100) return "over";
  const resetsAt = window.resetsAt;
  if (!resetsAt || !Number.isFinite(resetsAt) || periodSeconds <= 0)
    return remainingTone(remaining);
  const remainingFraction = Math.min(1, Math.max(0, resetsAt - now / 1000) / periodSeconds);
  const delta = window.usedPercent - (1 - remainingFraction) * 100;
  if (delta <= -15) return "spare";
  if (delta <= 8) return "normal";
  if (delta <= 22) return "hot";
  return "over";
}

function countdown(resetsAt: number | null | undefined, now: number): string {
  if (!resetsAt || !Number.isFinite(resetsAt)) return "—";
  const seconds = resetsAt - now / 1000;
  if (seconds <= 0) return "сейчас";
  if (seconds < 60) return "<1м";
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days) return `${days}д${hours % 24 ? ` ${hours % 24}ч` : ""}`;
  if (hours) return `${hours}ч${minutes % 60 ? ` ${minutes % 60}м` : ""}`;
  return `${minutes}м`;
}

const TONE_COLOR: Record<AgentUsageTone, string> = {
  spare: "var(--info)",
  normal: "var(--muted)",
  hot: "var(--warn)",
  over: "var(--err)",
};

function mountUsage(
  container: HTMLElement,
  context: {
    usageUrl?: string;
    signal: AbortSignal;
    publishSummary(remaining: number | null, tone?: AgentUsageTone | null): void;
  },
): () => void {
  const doc = container.ownerDocument;
  container.replaceChildren();
  const poll = new AbortController();
  const stop = () => poll.abort();
  context.signal.addEventListener("abort", stop);

  const root = doc.createElement("button");
  root.type = "button";
  root.className = "claude-usage";
  root.style.cssText = [
    "position:relative",
    "display:inline-flex",
    "align-items:center",
    "gap:6px",
    "min-height:24px",
    "padding:0",
    "border:0",
    "background:transparent",
    "color:var(--muted)",
    "font:inherit",
    "font-size:var(--fs-2xs)",
    "cursor:pointer",
  ].join(";");

  const prefix = doc.createElement("span");
  prefix.className = "claude-usage-prefix";
  prefix.textContent = "нед";

  const value = doc.createElement("span");
  value.className = "claude-usage-value";
  value.textContent = "…";

  const tip = doc.createElement("span");
  tip.className = "claude-usage-tip";
  tip.setAttribute("role", "tooltip");
  tip.style.cssText = [
    "position:absolute",
    "z-index:30",
    "right:0",
    "bottom:calc(100% + 7px)",
    "padding:7px 9px",
    "border:1px solid var(--line)",
    "border-radius:5px",
    "background:var(--bg)",
    "color:var(--text)",
    "font-size:var(--fs-2xs)",
    "white-space:pre-line",
    "width:max-content",
    "max-width:min(340px,80vw)",
    "box-shadow:0 3px 12px #0002",
    "opacity:0",
    "visibility:hidden",
    "pointer-events:none",
  ].join(";");
  tip.textContent = "Claude Code · Неделя\nЗагрузка лимитов…";

  const style = doc.createElement("style");
  style.textContent =
    ".claude-usage:hover .claude-usage-tip,.claude-usage:focus-visible .claude-usage-tip{opacity:1;visibility:visible}";

  root.append(prefix, value, tip);
  container.append(style, root);

  let selected: WindowName = "weekly";
  let payload: UsagePayload | null = null;
  let failed = false;

  function paint() {
    const heading = (name: WindowName) => {
      const definition = WINDOWS.find((item) => item.name === name)!;
      return `Claude Code · ${definition.label}`;
    };
    if (failed) {
      prefix.textContent = WINDOWS.find((item) => item.name === selected)!.shortLabel;
      value.textContent = "—";
      root.style.color = "var(--muted)";
      tip.textContent = `${heading(selected)}\nНе удалось обновить лимиты`;
      context.publishSummary(null, null);
      return;
    }
    if (!payload) {
      prefix.textContent = "нед";
      value.textContent = "…";
      root.style.color = "var(--muted)";
      tip.textContent = `${heading("weekly")}\nЗагрузка лимитов…`;
      context.publishSummary(null, null);
      return;
    }
    if (payload.status !== "ready" || !payload.windows) {
      prefix.textContent = WINDOWS.find((item) => item.name === selected)!.shortLabel;
      value.textContent = "—";
      root.style.color = "var(--muted)";
      tip.textContent = `${heading(selected)}\n${payload.message ?? "Лимиты недоступны"}`;
      context.publishSummary(null, null);
      return;
    }
    const now = Date.now();
    const rows = WINDOWS.flatMap((definition) => {
      const data = payload!.windows?.[definition.name];
      return data ? [{ definition, data }] : [];
    });
    const current = rows.find((row) => row.definition.name === selected) ?? rows[0] ?? undefined;
    if (!current) {
      prefix.textContent = "нед";
      value.textContent = "—";
      root.style.color = "var(--muted)";
      tip.textContent = `${heading(selected)}\nЛимиты недоступны`;
      context.publishSummary(null, null);
      return;
    }
    selected = current.definition.name;
    const remaining = remainingOf(current.data);
    const tone = windowTone(current.data, current.definition.periodSeconds, now);
    prefix.textContent = current.definition.shortLabel;
    value.textContent = `${remaining}%`;
    root.style.color = TONE_COLOR[tone];
    tip.textContent = [
      `${heading(current.definition.name)} · остаток`,
      ...rows.map((row) => {
        const left = remainingOf(row.data);
        const limited = row.data.limited ? " · исчерпан" : "";
        return `${row.definition.label}: ${left}%${limited} · ${countdown(row.data.resetsAt, now)}`;
      }),
      "Клик — сменить лимит",
    ].join("\n");
    context.publishSummary(remaining, tone);
  }

  function cycle() {
    const available = WINDOWS.filter((item) => payload?.windows?.[item.name]).map(
      (item) => item.name,
    );
    const order = available.length ? available : WINDOWS.map((item) => item.name);
    const index = order.indexOf(selected);
    selected = order[(index + 1) % order.length]!;
    paint();
    return { window: selected };
  }

  cycleWindow = cycle;
  root.addEventListener("click", cycle);

  async function refresh() {
    if (poll.signal.aborted || !context.usageUrl) return;
    try {
      const response = await fetch(context.usageUrl, { signal: poll.signal });
      if (!response.ok) throw new Error("Usage unavailable");
      payload = (await response.json()) as UsagePayload;
      failed = false;
    } catch (error) {
      if (poll.signal.aborted) return;
      failed = true;
      if (!(error instanceof Error && error.name === "AbortError")) payload = payload ?? null;
    }
    if (!poll.signal.aborted) paint();
  }

  paint();
  void refresh();
  const clock = doc.defaultView ?? globalThis;
  const timer = clock.setInterval(() => void refresh(), 60_000);

  return () => {
    context.signal.removeEventListener("abort", stop);
    poll.abort();
    clock.clearInterval(timer);
    root.removeEventListener("click", cycle);
    if (cycleWindow === cycle) cycleWindow = undefined;
    container.replaceChildren();
  };
}

const plugin = definePlugin({
  apiVersion: 1,
  activate(api: PluginApi) {
    api.commands.register({
      id: api.commands.prefix + "usage.window.cycle",
      title: "Переключить отображаемый лимит Claude Code",
      description: "Переключает окно лимита Claude Code между неделей и 5 часами.",
      run: () => cycleWindow?.(),
    });
    api.agents.register({
      id: "claude-code",
      plan,
      toolLabel,
      mountUsage,
    });
  },
});

export default plugin;
