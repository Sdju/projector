import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ToolSet } from "ai";
import { dataDir } from "../../../../core/modules/app-paths/index.ts";

/** When a hook runs: before a tool (it may forbid the call), after it, and when the turn is over. */
export type HookEvent = "PreToolUse" | "PostToolUse" | "Stop";

export interface Hook {
  event: HookEvent;
  command: string;
  /** Regular expression over the tool name; no matcher means every tool. Ignored for `Stop`. */
  matcher?: RegExp;
  timeoutMs: number;
  /** `Stop` only: the hook runs when the turn lasted at least this long. */
  minSeconds: number;
}

const EVENTS: HookEvent[] = ["PreToolUse", "PostToolUse", "Stop"];
const DEFAULT_TIMEOUT_MS = 30_000;
const OUTPUT_CHARS = 2_000;

export const hooksFile = () => join(dataDir(), "agent", "hooks.json");

interface Entry {
  command?: unknown;
  matcher?: unknown;
  timeout?: unknown;
  minSeconds?: unknown;
}

/**
 * The user's hooks from `<data>/agent/hooks.json`: `{ "hooks": { "Stop": [{ "command": "…" }] } }`.
 * Only the user's own file counts — a repository must not be able to run programs on every tool call.
 */
export async function loadHooks(): Promise<Hook[]> {
  let data: { hooks?: Record<string, Entry[]> };
  try {
    data = JSON.parse(await readFile(hooksFile(), "utf8"));
  } catch {
    return [];
  }
  const hooks: Hook[] = [];
  for (const event of EVENTS) {
    const entries = data.hooks?.[event];
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (typeof entry?.command !== "string" || !entry.command.trim()) continue;
      let matcher: RegExp | undefined;
      try {
        if (typeof entry.matcher === "string" && entry.matcher) matcher = new RegExp(entry.matcher);
      } catch {
        continue;
      }
      hooks.push({
        event,
        command: entry.command,
        matcher,
        timeoutMs:
          typeof entry.timeout === "number" && entry.timeout > 0
            ? entry.timeout * 1000
            : DEFAULT_TIMEOUT_MS,
        minSeconds: typeof entry.minSeconds === "number" ? entry.minSeconds : 0,
      });
    }
  }
  return hooks;
}

interface Outcome {
  code: number | null;
  output: string;
}

/** Runs one hook through the shell with the event as JSON on its input; a hook that hangs is killed. */
function runHook(
  hook: Hook,
  payload: Record<string, unknown>,
  cwd: string | undefined,
): Promise<Outcome> {
  return new Promise((resolve) => {
    const child = spawn(hook.command, {
      shell: true,
      cwd: cwd || undefined,
      env: { ...process.env, PROJECTOR_HOOK_EVENT: hook.event, PROJECTOR_PROJECT_DIR: cwd ?? "" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    const take = (chunk: Buffer) => {
      if (output.length < OUTPUT_CHARS) output += chunk.toString();
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const timer = setTimeout(() => child.kill("SIGKILL"), hook.timeoutMs);
    const done = (code: number | null, extra = "") => {
      clearTimeout(timer);
      resolve({ code, output: (output + extra).trim().slice(0, OUTPUT_CHARS) });
    };
    child.on("error", (error) => done(null, error.message));
    child.on("close", (code) => done(code));
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ event: hook.event, cwd, ...payload }));
  });
}

/** Exit code 2 of a `PreToolUse` hook forbids the call and its output tells the model why. */
const BLOCKS = 2;

/** Gives every tool of the turn its `PreToolUse` and `PostToolUse` hooks. */
export function withHooks(tools: ToolSet, hooks: Hook[], cwd: string | undefined): ToolSet {
  if (!hooks.some((hook) => hook.event !== "Stop")) return tools;
  const wrapped: ToolSet = {};
  for (const [name, item] of Object.entries(tools)) {
    const run = item.execute;
    if (!run) {
      wrapped[name] = item;
      continue;
    }
    const matching = (event: HookEvent) =>
      hooks.filter((hook) => hook.event === event && (!hook.matcher || hook.matcher.test(name)));
    wrapped[name] = {
      ...item,
      execute: async (input: unknown, context: never) => {
        for (const hook of matching("PreToolUse")) {
          const outcome = await runHook(hook, { tool: name, input }, cwd);
          if (outcome.code === BLOCKS)
            throw new Error(`Хук запретил вызов: ${outcome.output || hook.command}`);
        }
        const output = await (run as (input: unknown, context: never) => unknown)(input, context);
        for (const hook of matching("PostToolUse")) await runHook(hook, { tool: name, input }, cwd);
        return output;
      },
    } as typeof item;
  }
  return wrapped;
}

/** The `Stop` hooks, after the answer; `seconds` is how long the turn took. */
export async function runStopHooks(
  hooks: Hook[],
  cwd: string | undefined,
  info: { seconds: number; text: string },
): Promise<void> {
  for (const hook of hooks) {
    if (hook.event !== "Stop" || info.seconds < hook.minSeconds) continue;
    await runHook(
      hook,
      { seconds: Math.round(info.seconds), text: info.text.slice(0, 2_000) },
      cwd,
    );
  }
}
