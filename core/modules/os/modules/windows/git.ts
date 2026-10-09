import { rename } from "node:fs/promises";
import type { AskpassScript, AskpassSpec } from "../../contract.ts";

/** Both values are spliced into script text, so anything but plain identifiers is refused. */
export function checkAskpass({ username, tokenEnv }: AskpassSpec): void {
  if (!/^[\w.-]+$/.test(username) || !/^[A-Za-z_]\w*$/.test(tokenEnv))
    throw new Error("Недопустимые параметры askpass");
}

/** Git cannot execute a shebang script on Windows, so the helper is a `.cmd` file. */
export function gitAskpass(credentials: AskpassSpec): AskpassScript {
  checkAskpass(credentials);
  return {
    filename: "askpass.cmd",
    contents: [
      "@echo off",
      "setlocal EnableExtensions EnableDelayedExpansion",
      // Quoted assignment and delayed expansion keep `&`, `^` and `%` in the prompt or token inert.
      `set "ask=%~1"`,
      `if not "!ask:Username=!"=="!ask!" (`,
      `  echo(${credentials.username}`,
      ") else (",
      `  echo(!${credentials.tokenEnv}!`,
      ")",
      "",
    ].join("\r\n"),
  };
}

/** Windows refuses to rename onto an existing directory, so the rename is itself the atomic claim. */
export async function publishDirectory(source: string, destination: string): Promise<void> {
  try {
    await rename(source, destination);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES" || code === "ENOTEMPTY") {
      const { lstat } = await import("node:fs/promises");
      if (
        await lstat(destination).then(
          () => true,
          () => false,
        )
      )
        throw Object.assign(new Error("Папка уже существует"), { code: "EEXIST" });
    }
    throw error;
  }
}

/** Agent host sockets are named pipes here: nothing is left on disk. */
export async function removeAgentHostAddress(): Promise<void> {}
