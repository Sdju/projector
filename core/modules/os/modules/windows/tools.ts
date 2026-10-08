import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { bashExecutable } from "./directories.ts";
import { quoteForCmd } from "./agent-process.ts";
import { killTree } from "./kill-tree.ts";
import { runPowerShell } from "./ps.ts";

const execute = promisify(execFile);

export function commandExists(bin: string, env?: Record<string, string | undefined>): boolean {
  if (existsSync(bin)) return true;
  try {
    execFileSync("where.exe", [bin], {
      stdio: "ignore",
      windowsHide: true,
      env: (env ?? process.env) as NodeJS.ProcessEnv,
    });
    return true;
  } catch {
    return false;
  }
}

function dockerEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (/^DOCKER_(HOST|CONTEXT|TLS_VERIFY|CERT_PATH|API_VERSION)$/.test(key)) delete env[key];
  return env;
}

export function runDocker(
  args: string[],
  options: { cwd?: string; timeout?: number; signal?: AbortSignal } = {},
) {
  return execute("docker", args, {
    cwd: options.cwd,
    timeout: options.timeout ?? 15000,
    signal: options.signal,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    env: dockerEnv(),
  });
}

export function runNodeScript(
  script: string,
  args: string[],
  options: { cwd?: string; timeout?: number; signal?: AbortSignal } = {},
) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key) &&
        !/^DOCKER_(HOST|CONTEXT|TLS_VERIFY|CERT_PATH|API_VERSION)$/.test(key),
    ),
  );
  return execute(process.execPath, [script, ...args], {
    cwd: options.cwd,
    timeout: options.timeout ?? 30000,
    signal: options.signal,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    env,
  });
}

export function runDockerSync(args: string[]) {
  return execFileSync("docker", args, {
    env: dockerEnv(),
    timeout: 5000,
    stdio: "ignore",
    windowsHide: true,
  });
}

export function runBash(command: string, options: { cwd: string; signal?: AbortSignal }) {
  const bash = bashExecutable();
  if (!bash)
    return Promise.reject(new Error("Не найден Bash. Установите Git Bash или задайте SHELL"));
  return new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
    terminated?: boolean;
  }>((resolve, reject) => {
    if (options.signal?.aborted) return reject(new Error("Запрос остановлен"));
    const child = spawn(bash, ["--noprofile", "--norc", "-c", command], {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key),
        ),
      ),
    });
    const stdout: Buffer[] = [],
      stderr: Buffer[] = [];
    let bytes = 0,
      terminated = false;
    const kill = () => {
      terminated = true;
      try {
        child.kill();
      } catch {
        /* Already exited. */
      }
      child.stdout.destroy();
      child.stderr.destroy();
      if (child.pid) void killTree(child.pid);
    };
    const capture = (target: Buffer[], chunk: Buffer) => {
      const available = 256 * 1024 - bytes;
      if (available > 0) target.push(chunk.subarray(0, available));
      bytes += chunk.length;
      if (bytes > 256 * 1024) kill();
    };
    child.stdout.on("data", (chunk: Buffer) => capture(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => capture(stderr, chunk));
    const timer = setTimeout(kill, 30000);
    options.signal?.addEventListener("abort", kill, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", kill);
    };
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (exitCode) => {
      cleanup();
      if (child.pid) void killTree(child.pid);
      if (options.signal?.aborted) return reject(new Error("Запрос остановлен"));
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode,
        terminated,
      });
    });
  });
}

async function pathExists(path: string) {
  return lstat(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
}

/** Same result as GNU mv --update=none --no-copy: an existing target is left untouched. */
export async function moveNoReplace(source: string, target: string) {
  if (await pathExists(target)) return { stdout: "", stderr: "" };
  try {
    await runPowerShell(
      `
$src = $env:PROJECTOR_MOVE_SOURCE
$dst = $env:PROJECTOR_MOVE_TARGET
if ((Get-Item -LiteralPath $src).PSIsContainer) { [IO.Directory]::Move($src, $dst) }
else { [IO.File]::Move($src, $dst) }
`,
      { env: { PROJECTOR_MOVE_SOURCE: source, PROJECTOR_MOVE_TARGET: target } },
    );
  } catch (error) {
    if ((await pathExists(target)) && (await pathExists(source))) return { stdout: "", stderr: "" };
    throw error;
  }
  return { stdout: "", stderr: "" };
}

export function runPython(
  helper: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
) {
  const bin = commandExists("py") ? "py" : "python";
  const prefix = bin === "py" ? ["-3", "-I"] : ["-I"];
  return execute(bin, [...prefix, helper, ...args], {
    ...options,
    windowsHide: true,
    env: { ...process.env, PYTHONNOUSERSITE: "1" },
  });
}

export function searchFiles(
  args: string[],
  options: { cwd: string; timeout: number; maxBuffer: number },
) {
  return execute("rg", args, { ...options, windowsHide: true });
}

/**
 * node-pty looks for the exact file name on PATH, without PATHEXT: a bare `docker` is not found
 * although `docker.exe` is. Batch files cannot be started by CreateProcess at all, so they run
 * through cmd.exe.
 */
export function ptyCommand(file: string, args: string[]): { file: string; args: string[] } {
  const direct = /[\\/]/.test(file);
  const directories = direct ? [""] : (process.env.Path ?? process.env.PATH ?? "").split(";");
  const extensions = /\.[A-Za-z0-9]+$/.test(file)
    ? [""]
    : (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  for (const directory of directories)
    for (const extension of extensions) {
      const candidate = directory ? join(directory, file + extension) : file + extension;
      if (!existsSync(candidate)) continue;
      if (/\.(?:cmd|bat)$/i.test(candidate))
        return {
          file: process.env.ComSpec || "cmd.exe",
          args: ["/d", "/s", "/c", [candidate, ...args].map(quoteForCmd).join(" ")],
        };
      return { file: candidate, args };
    }
  return { file, args };
}

/** Windows has no execute bit: a file runs when its extension is one of PATHEXT (plus scripts). */
export function isExecutableFile(name: string, _mode: number): boolean {
  const extensions = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter(Boolean)
    .map((extension) => extension.toLowerCase());
  const lower = name.toLowerCase();
  return [...extensions, ".ps1"].some((extension) => lower.endsWith(extension));
}

let ownerSid: string | undefined;
function currentSid(): string {
  ownerSid ??= String(
    execFileSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], {
      encoding: "utf8",
      windowsHide: true,
    }),
  )
    .trim()
    .split(",")[1]!
    .replace(/"/g, "");
  return ownerSid;
}

/** Well-known groups that carry explicit entries on new files: Administrators, SYSTEM, Everyone, Users, Authenticated Users. */
const others = ["S-1-5-32-544", "S-1-5-18", "S-1-1-0", "S-1-5-32-545", "S-1-5-11"];

/** Everything after the grant: inheritance is gone, and the groups above lose their entries. */
const ownerOnly = (path: string) => [
  path,
  "/inheritance:r",
  "/grant:r",
  `*${currentSid()}:F`,
  ...others.filter((sid) => sid !== currentSid()).flatMap((sid) => ["/remove:g", `*${sid}`]),
];

/**
 * The Windows counterpart of 0600: the inherited entries are dropped and only the current user
 * keeps access, so other local accounts cannot read tokens and passwords.
 */
export async function restrictToOwner(path: string): Promise<void> {
  await execute("icacls.exe", ownerOnly(path), { windowsHide: true });
}
export function restrictToOwnerSync(path: string): void {
  execFileSync("icacls.exe", ownerOnly(path), { stdio: "ignore", windowsHide: true });
}
