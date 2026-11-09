import {
  pushSecretToPage,
  runSecretScript,
  type SecretShowRequest,
  type SecretShowResult,
} from "../../../agent/index.ts";

/** Runs the script and hands its value to the user's page; the caller only learns that it arrived. */
export async function showSecretOnPage(
  request: SecretShowRequest,
  options: { cwd?: string; projectId?: string; signal?: AbortSignal } = {},
): Promise<SecretShowResult> {
  try {
    const secret = await runSecretScript(request.script, {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return await pushSecretToPage({
      secret,
      ...(request.label ? { label: request.label } : {}),
      ...(request.comment ? { comment: request.comment } : {}),
      ...(options.projectId ? { projectId: options.projectId } : {}),
    });
  } catch (error) {
    return {
      shown: false,
      delivered: false,
      error: error instanceof Error ? error.message : "Скрипт не вернул секрет",
    };
  }
}
