import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { join } from "node:path";
import type { ToolSet } from "ai";
import { dataDir } from "../../../../core/modules/app-paths/index.ts";
import { guardProjectHooks, type GuardOptions } from "./projector-guard.ts";

/** When a hook runs: before a tool (it may forbid the call), after it, and when the turn is over. */
export type HookEvent = "PreToolUse" | "PostToolUse" | "Stop";

export interface Hook {
  event: HookEvent;
  /** `project` hooks come from a repository and are asked about first. */
  source: "user" | "project";
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

export const projectHooksFile = (cwd: string) => join(cwd, ".projector", "hooks.json");

function parseHooks(text: string, source: Hook["source"]): Hook[] {
  let data: { hooks?: Record<string, Entry[]> };
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const hooks: Hook[] = [];
  for (const event of EVENTS) {
    const entries = data?.hooks?.[event];
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
        source,
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

const read = (path: string) => readFile(path, "utf8").catch(() => "");

/** The hooks that apply to a project, as the settings page shows them (project ones not yet approved). */
export async function listHooks(cwd?: string): Promise<Hook[]> {
  return [
    ...parseHooks(await read(hooksFile()), "user"),
    ...(cwd ? parseHooks(await read(projectHooksFile(cwd)), "project") : []),
  ];
}

/**
 * The user's hooks from `<data>/agent/hooks.json` and the project's `.projector/hooks.json`:
 * `{ "hooks": { "Stop": [{ "command": "…" }] } }`. A repository's hooks run programs on its own
 * say-so, so the user is asked once per turn and a refusal leaves them out.
 */
export async function loadHooks(cwd?: string, guard?: GuardOptions): Promise<Hook[]> {
  const all = await listHooks(cwd);
  const project = all.filter((hook) => hook.source === "project");
  if (!project.length || !guard) return all.filter((hook) => hook.source === "user");
  try {
    await guardProjectHooks(
      guard,
      project.map((hook) => `${hook.event}: ${hook.command}`),
    );
    return all;
  } catch {
    return all.filter((hook) => hook.source === "user");
  }
}

/** The user's hook file as written, for the settings page; empty when there is none yet. */
export const readUserHooks = () => read(hooksFile());

/** Saves the user's hooks after checking the shape; empty text removes the file. */
export async function writeUserHooks(text: string): Promise<void> {
  const path = hooksFile();
  if (!text.trim()) {
    await rm(path, { force: true });
    return;
  }
  let data: { hooks?: Record<string, unknown> } | null;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`Не JSON: ${(error as Error).message}`);
  }
  const hooks = data?.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks))
    throw new Error('Нужен объект вида { "hooks": { "Stop": [{ "command": "…" }] } }');
  for (const [event, entries] of Object.entries(hooks)) {
    if (!EVENTS.includes(event as HookEvent))
      throw new Error(`Неизвестное событие «${event}»; есть ${EVENTS.join(", ")}`);
    if (!Array.isArray(entries)) throw new Error(`${event}: нужен список хуков`);
    for (const entry of entries as Entry[]) {
      if (typeof entry?.command !== "string" || !entry.command.trim())
        throw new Error(`${event}: у хука нет command`);
      if (typeof entry.matcher === "string")
        try {
          new RegExp(entry.matcher);
        } catch {
          throw new Error(`${event}: matcher «${entry.matcher}» — не регулярное выражение`);
        }
    }
  }
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, text.trim() + "\n", { mode: 0o600 });
  await rename(temporary, path);
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

/** A hook may also answer with JSON: `{ "decision": "block", "reason": "…", "additionalContext": "…" }`. */
function answerOf(outcome: Outcome): { block?: string; context?: string } {
  let data: { decision?: unknown; reason?: unknown; additionalContext?: unknown } | undefined;
  try {
    data = JSON.parse(outcome.output);
  } catch {
    // Plain text: only the exit code speaks.
  }
  const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
  const block =
    outcome.code === BLOCKS
      ? outcome.output || "без объяснения"
      : data?.decision === "block"
        ? (text(data.reason) ?? "без объяснения")
        : undefined;
  return { block, context: text(data?.additionalContext) };
}

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
          const { block } = answerOf(await runHook(hook, { tool: name, input }, cwd));
          if (block) throw new Error(`Хук запретил вызов: ${block}`);
        }
        const output = await (run as (input: unknown, context: never) => unknown)(input, context);
        const notes: string[] = [];
        for (const hook of matching("PostToolUse")) {
          const { context } = answerOf(await runHook(hook, { tool: name, input }, cwd));
          if (context) notes.push(context);
        }
        return notes.length ? { result: output, hook: notes.join("\n") } : output;
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
