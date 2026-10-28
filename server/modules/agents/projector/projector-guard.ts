import type { ApprovalAnswer, ApprovalRequest } from "../../agent/index.ts";
import * as path from "node:path";
import * as os from "node:os";

export interface GuardOptions {
  /** Where the project's remembered decisions are kept. */
  cwd?: string;
  approve?: (request: ApprovalRequest) => Promise<ApprovalAnswer>;
  /** The user chose not to be asked. */
  trusting: boolean;
  /** `auto` mode: a model decides whether a shell command runs unasked; unsafe ones are asked. */
  review?: (command: string) => Promise<{ safe: boolean; reason: string }>;
}

/** Single-letter flags that may be combined (`-la`) and long flags; anything else is asked about. */
interface FlagRules {
  short: string;
  long?: string[];
}

const GIT_RULES = new Map<string, FlagRules>([
  ["status", { short: "sb", long: ["--short", "--branch", "--porcelain"] }],
  ["rev-parse", { short: "", long: ["--show-toplevel", "--abbrev-ref", "--is-inside-work-tree"] }],
  ["describe", { short: "", long: ["--tags", "--always", "--dirty"] }],
]);

/** Only commands that show names, not file contents. */
const BINARY_RULES = new Map<string, FlagRules>([
  ["pwd", { short: "" }],
  ["ls", { short: "alhrtRSdAFi1" }],
  ["whoami", { short: "" }],
  ["uname", { short: "asnrvmpio" }],
  ["date", { short: "uR" }],
  ["which", { short: "a" }],
]);

const SECRET_NAMES = new Set([".ssh", ".aws", ".npmrc", ".netrc", ".git-credentials"]);
const SECRET_PATTERNS = [/(^\.|\.)env($|\.)/i, /\.(pem|key)$/i, /^id_(rsa|ed25519)/i, /\.kdbx$/i];

/** True for anything outside the project or with a path segment that looks like a secret. */
function isForbiddenPath(target: string, cwd?: string): boolean {
  if (target.startsWith("~")) return true;
  const base = path.resolve(cwd ?? process.cwd());
  const full = path.resolve(base, target);
  const relative = path.relative(base, full);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    return true;
  if (full.startsWith(path.join(os.homedir(), ".local/share/projector"))) return true;
  return relative
    .split(path.sep)
    .some(
      (segment) =>
        SECRET_NAMES.has(segment.toLowerCase()) ||
        SECRET_PATTERNS.some((pattern) => pattern.test(segment)),
    );
}

/** Quotes must wrap the whole word, and an unquoted glob could expand to a secret. */
function wordIsSafe(word: string, cwd?: string): boolean {
  const quoted = /^'([^']*)'$|^"([^"]*)"$/.exec(word);
  if (!quoted && /['"*?[\]]/.test(word)) return false;
  return !isForbiddenPath(quoted ? (quoted[1] ?? quoted[2] ?? "") : word, cwd);
}

function flagIsAllowed(word: string, rules: FlagRules): boolean {
  if (word.startsWith("--")) return !!rules.long?.includes(word);
  return word
    .slice(1)
    .split("")
    .every((letter) => rules.short.includes(letter));
}

/** Flags must be on the allowlist; every other word is checked as a path. */
function argsAreSafe(words: string[], rules: FlagRules, cwd?: string): boolean {
  return words.every((word) =>
    word.length > 1 && word.startsWith("-") ? flagIsAllowed(word, rules) : wordIsSafe(word, cwd),
  );
}

/** A command that only shows names: simple words joined by `|` or `&&`, no redirects or substitution. */
export function isReadOnlyBash(command: string, cwd?: string): boolean {
  if (/[<>`$(){};\n\\]|(?<!&)&(?!&)/.test(command)) return false;
  return command
    .split(/\|\||&&|\|/)
    .map((part) => part.trim().split(/\s+/))
    .every(([binary = "", ...args]) => {
      if (binary !== "git") {
        const rules = BINARY_RULES.get(binary);
        return !!rules && argsAreSafe(args, rules, cwd);
      }
      const [sub = "", ...rest] = args;
      const rules = GIT_RULES.get(sub);
      return !!rules && argsAreSafe(rest, rules, cwd);
    });
}

const CHANGING = new Set(
  "delete remove rm clear kill stop reset discard revert push pull commit stage unstage merge clone install uninstall password run exec start restart save import write create new rename move add set apply send input login logout shell prune build up down".split(
    " ",
  ),
);
const LOOKING = new Set(
  "read result list get info search refresh describe status find more filter open toggle focus show copy".split(
    " ",
  ),
);

/** Commands that only look at or open something do not need the user's permission. */
export function commandIsSafe(command: string): boolean {
  const words = command.split(/[.\-_]|(?<=[a-z])(?=[A-Z])/).map((word) => word.toLowerCase());
  return words.some((word) => LOOKING.has(word)) && !words.some((word) => CHANGING.has(word));
}

const remembered = new Map<string, Set<string>>();

const DENIED = "Пользователь отклонил действие";

async function ask(options: GuardOptions, request: ApprovalRequest): Promise<ApprovalAnswer> {
  if (!options.approve) throw new Error("Клиент не может показать запрос разрешения");
  const answer = await options.approve(request).catch(() => false);
  if (!answer) throw new Error(DENIED);
  return answer;
}

/** Asks before a command changes the user's machine; reading is let through. */
export async function guardBash(options: GuardOptions, command: string): Promise<void> {
  if (options.trusting || isReadOnlyBash(command, options.cwd)) return;
  const verdict = await options.review?.(command);
  if (verdict?.safe) return;
  await ask(options, {
    tool: "bash",
    input: { command },
    title: "Выполнить команду в оболочке",
    detail: verdict ? `${command}\n\nПроверка безопасности: ${verdict.reason}` : command,
  });
}

/** Asks before a Projector command that changes something; the answer may be remembered. */
export async function guardCommand(
  options: GuardOptions,
  call: { command: string; scope: string; args?: Record<string, unknown> },
): Promise<void> {
  if (options.trusting || commandIsSafe(call.command)) return;
  const known = remembered.get(options.cwd ?? "");
  if (known?.has(call.command)) return;
  const args = call.args && Object.keys(call.args).length ? JSON.stringify(call.args, null, 2) : "";
  const answer = await ask(options, {
    tool: "execute_command",
    input: call,
    title: `Команда Projector: ${call.command}`,
    detail: [`${call.command}`, `scope: ${call.scope}`, args].filter(Boolean).join("\n"),
    persistent: true,
  });
  if (answer === "always") {
    const key = options.cwd ?? "";
    remembered.set(key, (remembered.get(key) ?? new Set()).add(call.command));
  }
}

/** Asks before the agent writes to its notes: they shape every later answer. */
export async function guardMemory(
  options: GuardOptions,
  call: { scope: string; mode: string; text: string },
): Promise<void> {
  if (options.trusting) return;
  await ask(options, {
    tool: "memory_write",
    input: call,
    title: call.scope === "user" ? "Запомнить для всех проектов" : "Запомнить для этого проекта",
    detail: `${call.mode === "append" ? "Добавить" : "Заменить заметки на"}:\n${call.text}`,
  });
}

/** A server from the project's `.mcp.json` starts a program from the repository: the user decides. */
export async function guardMcpServer(
  options: GuardOptions,
  server: { name: string } & ({ command: string; args: string[] } | { url: string }),
): Promise<void> {
  if (options.trusting) return;
  const target = "command" in server ? [server.command, ...server.args].join(" ") : server.url;
  await ask(options, {
    tool: "mcp_server",
    input: { name: server.name },
    title: `Запустить MCP-сервер ${server.name} из .mcp.json проекта`,
    detail: target,
  });
}

const knownHooks = new Set<string>();

/**
 * Hooks from the project's `.projector/hooks.json` run programs on every call: the user decides.
 * "Always" is remembered until the server restarts, for exactly these commands in this project,
 * so a changed file is asked about again.
 */
export async function guardProjectHooks(options: GuardOptions, commands: string[]): Promise<void> {
  if (options.trusting) return;
  const key = `${options.cwd ?? ""}\n${commands.join("\n")}`;
  if (knownHooks.has(key)) return;
  const answer = await ask(options, {
    tool: "project_hooks",
    input: {},
    title: "Включить хуки из .projector/hooks.json проекта",
    detail: commands.join("\n"),
    persistent: true,
  });
  if (answer === "always") knownHooks.add(key);
}

const knownHosts = new Set<string>();

/** Asks before the agent opens a site: the address itself can carry what it has read. Remembered by host. */
export async function guardWebFetch(options: GuardOptions, address: string): Promise<void> {
  if (options.trusting) return;
  let host = "";
  try {
    host = new URL(address).host;
  } catch {
    return;
  }
  if (knownHosts.has(host)) return;
  const answer = await ask(options, {
    tool: "web_fetch",
    input: { url: address },
    title: `Открыть страницу на ${host}`,
    detail: address,
    persistent: true,
  });
  if (answer === "always") knownHosts.add(host);
}

/** Asks before an MCP tool runs, unless the server says the tool only reads. */
export async function guardMcpTool(
  options: GuardOptions,
  call: { server: string; tool: string; input: unknown; readOnly: boolean },
): Promise<void> {
  if (options.trusting || call.readOnly) return;
  await ask(options, {
    tool: "mcp_tool",
    input: call,
    title: `MCP ${call.server}: ${call.tool}`,
    detail: JSON.stringify(call.input ?? {}, null, 2),
  });
}
