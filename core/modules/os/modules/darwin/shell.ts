import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { dataHome } from "./directories.ts";
import { hotkeyPath, hotkeys } from "./shortcut.ts";

const execute = promisify(execFile);
const source = fileURLToPath(new URL("./helper.swift", import.meta.url));
const iconPath = fileURLToPath(new URL("../../../../../resources/icons/64.png", import.meta.url));

/** Compiles the Swift helper once per source version; compilation needs the Xcode command line tools. */
export async function ensureHelper(): Promise<string> {
  const code = await readFile(source);
  const hash = createHash("sha256").update(code).digest("hex").slice(0, 12);
  const directory = join(dataHome(), "projector", "native");
  const binary = join(directory, `shell-${hash}`);
  if (existsSync(binary)) return binary;
  await mkdir(directory, { recursive: true });
  const partial = `${binary}.${process.pid}.tmp`;
  try {
    await execute("swiftc", ["-O", "-o", partial, source], { timeout: 180_000 });
  } catch (error) {
    throw new Error(
      `Не удалось собрать системный помощник (нужны Xcode Command Line Tools): ${(error as Error).message}`,
    );
  }
  await rename(partial, binary);
  return binary;
}

/** Whether another application already owns the hotkey. */
export async function probeHotkey(shortcut: string): Promise<boolean> {
  const { stdout } = await execute(await ensureHelper(), ["--probe", shortcut], {
    timeout: 10_000,
  });
  return stdout.trim() === "hotkey:ok";
}

export interface ShellHandlers {
  onActivate(): void;
  onHotkey(): void;
  onSettings(): void;
  onRestart(): void;
  onQuit(): void;
}

export async function startDesktopShell(dataDirectory: string, handlers: ShellHandlers) {
  const binary = await ensureHelper();
  const child: ChildProcess = spawn(binary, [iconPath], { stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: child.stdout! });
  let pending: ((line: string) => void) | undefined;
  let ready!: () => void;
  const started = new Promise<void>((resolve) => (ready = resolve));
  child.once("error", () => ready());
  lines.on("line", (line) => {
    if (line === "ready") ready();
    else if (line.startsWith("hotkey:")) pending?.(line);
    else if (line === "event:activate") handlers.onActivate();
    else if (line === "event:hotkey") handlers.onHotkey();
    else if (line === "event:settings") handlers.onSettings();
    else if (line === "event:restart") handlers.onRestart();
    else if (line === "event:quit") handlers.onQuit();
  });
  child.once("exit", () => handlers.onQuit());
  await started;
  const writeState = (shortcut: string, active: boolean) =>
    mkdir(dataDirectory, { recursive: true }).then(() =>
      writeFile(hotkeyPath(dataDirectory), JSON.stringify({ shortcut, active })),
    );
  return {
    async configure(shortcut: string) {
      if (!shortcut) return void (await writeState("", false));
      if (!hotkeys[shortcut]) {
        await writeState(shortcut, false);
        throw new Error(`Сочетание ${shortcut} не поддерживается на macOS`);
      }
      const reply = await new Promise<string>((resolve) => {
        pending = resolve;
        child.stdin!.write(`hotkey ${shortcut}\n`);
      });
      await writeState(shortcut, reply === "hotkey:ok");
      if (reply !== "hotkey:ok") throw new Error(`Сочетание ${shortcut} уже занято`);
    },
    async stop() {
      await writeState("", false).catch(() => undefined);
      child.stdin?.write("quit\n");
      setTimeout(() => child.kill(), 1000).unref();
    },
  };
}
