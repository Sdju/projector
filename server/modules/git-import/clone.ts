import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpError } from "../http/index.ts";

const exec = promisify(execFile);

export interface HttpsCredentials {
  /** HTTPS user name the host expects together with the token. */
  username: string;
  /** Environment variable that carries the token to the askpass helper. */
  tokenEnv: string;
  /** Shown when `git clone` fails; never includes the token. */
  failure: string;
}

/** Shell helper on Linux; `.cmd` on Windows, where Git cannot execute a shebang script. */
function askpassHelper(credentials: HttpsCredentials): { filename: string; contents: string } {
  if (process.platform === "win32")
    return {
      filename: "askpass.cmd",
      contents: [
        "@echo off",
        "setlocal EnableExtensions",
        `echo %~1 | findstr /I /C:"Username" >nul`,
        "if errorlevel 1 (",
        `  echo.%${credentials.tokenEnv}%`,
        ") else (",
        `  echo.${credentials.username}`,
        ")",
        "",
      ].join("\r\n"),
    };
  return {
    filename: "askpass",
    contents: `#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" "${credentials.username}" ;; *) printf "%s\\n" "$${credentials.tokenEnv}" ;; esac\n`,
  };
}

/** Hardened HTTPS clone: no hooks, no redirects, token only through a temporary askpass helper. */
export async function cloneOverHttps(
  url: string,
  destination: string,
  token: string,
  credentials: HttpsCredentials,
  signal?: AbortSignal,
) {
  const helper = await mkdtemp(join(tmpdir(), "projector-git-"));
  try {
    const script = askpassHelper(credentials);
    const askpass = join(helper, script.filename);
    await writeFile(askpass, script.contents, { mode: 0o700 });
    await exec(
      "git",
      [
        "-c",
        "credential.helper=",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "http.followRedirects=false",
        "clone",
        "--",
        url,
        destination,
      ],
      {
        env: {
          ...process.env,
          GIT_ASKPASS: askpass,
          GIT_TERMINAL_PROMPT: "0",
          [credentials.tokenEnv]: token,
        },
        timeout: 300_000,
        maxBuffer: 1024 * 1024,
        signal,
      },
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new HttpError(400, credentials.failure);
  } finally {
    await rm(helper, { recursive: true, force: true });
  }
}
