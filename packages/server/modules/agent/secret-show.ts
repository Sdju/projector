import { appUrl } from "@projector-ai/core/modules/app-paths/index.ts";
import { os } from "@projector-ai/core/modules/os/index.ts";
import { loadProjects } from "../projects/index.ts";

/** Limits shared by the tool, the widget endpoint and the panel event. */
export const SECRET_SHOW_LIMITS = {
  secret: 32 * 1024,
  comment: 1_000,
  label: 200,
  script: 8_000,
} as const;

/** A script the agent wrote; its stdout is the secret and never reaches the model. */
export interface SecretShowRequest {
  script: string;
  label?: string;
  comment?: string;
}

/** What the agent learns: the value reached a page (or why it did not), never the value itself. */
export interface SecretShowResult {
  shown: boolean;
  delivered: boolean;
  label?: string;
  error?: string;
}

/** A script failure. `detail` is for the page only; tool results use `message` alone. */
export class SecretScriptError extends Error {
  readonly detail: string;
  constructor(message: string, detail = "") {
    super(message);
    this.name = "SecretScriptError";
    this.detail = detail;
  }
}

const detailOf = (text: string | undefined): string =>
  (text ?? "").replaceAll("\0", "").slice(0, 2_000);

export interface SecretShowPush {
  /** A script already produced this value; only the page may receive it. */
  secret: string;
  label?: string;
  comment?: string;
  /** The chat's project, so the panel appears in that project's active chat. */
  projectId?: string;
  /** The MCP session whose page should show the panel, when known. */
  session?: string;
}

/** The project's folder, for scripts that use relative paths; `undefined` when the chat has none. */
export async function projectDirectory(projectId: string | undefined): Promise<string | undefined> {
  if (!projectId) return undefined;
  try {
    return (await loadProjects()).find((project) => project.id === projectId)?.path;
  } catch {
    return undefined;
  }
}

/**
 * Runs the agent's script and returns only its stdout. A failure never carries stderr: a script
 * that printed the secret to the wrong stream must not put it into a tool result.
 */
export async function runSecretScript(
  script: string,
  options: { cwd?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const command = script.trim();
  if (!command) throw new Error("Укажите скрипт, который вернёт секрет");
  if (command.length > SECRET_SHOW_LIMITS.script) throw new Error("Скрипт слишком длинный");
  if (options.signal?.aborted) throw new Error("Запрос остановлен");
  let result: Awaited<ReturnType<typeof os.tools.runBash>>;
  try {
    result = await os.tools.runBash(command, {
      cwd: options.cwd || os.homeDirectory(),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (options.signal?.aborted || (error instanceof Error && /остановлен/.test(error.message)))
      throw new Error("Запрос остановлен");
    const stderr = (error as { stderr?: string } | undefined)?.stderr;
    throw new SecretScriptError("Скрипт не запустился", detailOf(stderr));
  }
  if (result.terminated)
    throw new SecretScriptError("Скрипт не завершился вовремя", detailOf(result.stderr));
  if (result.exitCode !== 0)
    throw new SecretScriptError("Скрипт завершился с ошибкой", detailOf(result.stderr));
  // Only the line ending is dropped: a key or password may legitimately start or end with a space.
  const secret = result.stdout.replace(/[\r\n]+$/, "");
  if (!secret.trim())
    throw new SecretScriptError("Скрипт ничего не вернул", detailOf(result.stderr));
  if (secret.length > SECRET_SHOW_LIMITS.secret) throw new Error("Секрет слишком длинный");
  if (secret.includes("\0")) throw new Error("Секрет содержит недопустимый символ");
  return secret;
}

/**
 * Hands a value to the live page. The value travels only on the server's loopback event stream;
 * the response says whether a page was open and never repeats the secret.
 */
export async function pushSecretToPage(
  input: SecretShowPush,
  baseUrl = process.env.PROJECTOR_URL || appUrl(),
): Promise<SecretShowResult> {
  if (!input.secret || input.secret.length > SECRET_SHOW_LIMITS.secret)
    return { shown: false, delivered: false, error: "Недопустимый секрет" };
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/agent/secret-show/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: input.secret,
        ...(input.label ? { label: input.label.slice(0, SECRET_SHOW_LIMITS.label) } : {}),
        ...(input.comment ? { comment: input.comment.slice(0, SECRET_SHOW_LIMITS.comment) } : {}),
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.session ? { session: input.session } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await response.json().catch(() => ({}))) as Partial<SecretShowResult> & {
      error?: string;
    };
    if (!response.ok)
      return {
        shown: false,
        delivered: false,
        error: typeof data.error === "string" ? data.error : "Projector не показал секрет",
      };
    return {
      shown: data.shown === true,
      delivered: data.delivered === true,
      ...(typeof data.label === "string" && data.label ? { label: data.label } : {}),
      ...(typeof data.error === "string" && data.error ? { error: data.error } : {}),
    };
  } catch {
    return { shown: false, delivered: false, error: "Projector недоступен" };
  }
}
