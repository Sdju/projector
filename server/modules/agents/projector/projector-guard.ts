import type { ApprovalAnswer, ApprovalRequest } from "../../agent/index.ts";

export interface GuardOptions {
  /** Where the project's remembered decisions are kept. */
  cwd?: string;
  approve?: (request: ApprovalRequest) => Promise<ApprovalAnswer>;
  /** The user chose not to be asked. */
  trusting: boolean;
  /** `auto` mode: a model decides whether a shell command runs unasked; unsafe ones are asked. */
  review?: (command: string) => Promise<{ safe: boolean; reason: string }>;
}

const READ_ONLY_BINARIES = new Set([
  "ls",
  "cat",
  "pwd",
  "head",
  "tail",
  "wc",
  "stat",
  "file",
  "du",
  "df",
  "which",
  "grep",
  "rg",
  "sort",
  "uniq",
  "tree",
  "date",
  "uname",
  "whoami",
  "realpath",
  "basename",
  "dirname",
]);
const READ_ONLY_GIT = new Set([
  "status",
  "diff",
  "log",
  "show",
  "ls-files",
  "rev-parse",
  "describe",
  "blame",
  "remote",
]);

/** A command that only reads: simple words joined by `|` or `&&`, no redirects or substitution. */
export function isReadOnlyBash(command: string): boolean {
  if (/[<>`$(){};\n\\]|(?<!&)&(?!&)/.test(command)) return false;
  return command
    .split(/\|\||&&|\|/)
    .map((part) => part.trim().split(/\s+/))
    .every(([binary, sub, ...rest]) => {
      if (!binary) return false;
      if (binary === "git") return !!sub && READ_ONLY_GIT.has(sub) && !rest.includes("--output");
      if (binary === "find")
        return ![sub, ...rest].some((word) =>
          /^-(delete|exec|execdir|ok|fprint|fls)/.test(word ?? ""),
        );
      return READ_ONLY_BINARIES.has(binary);
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
  if (options.trusting || isReadOnlyBash(command)) return;
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
