import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { os } from "@ai-projector/core/modules/os/index.ts";
import {
  appUrl,
  configuredAppPort,
  readServerMode,
} from "@ai-projector/core/modules/app-paths/index.ts";
import type { ServerMode } from "@ai-projector/core/modules/server-mode/index.ts";
import { commandLogs } from "../commands/logs.ts";
import { commandOpen, commandSettings, commandToggle } from "../commands/open.ts";
import { commandProjects } from "../commands/projects.ts";
import { commandRun, commandStop } from "../commands/run.ts";
import { commandSearch } from "../commands/search.ts";
import { commandQuit, commandRestart } from "../commands/server.ts";
import { commandStatus } from "../commands/status.ts";
import type { Output } from "../common/output.ts";
import { createApi } from "../modules/api/index.ts";
import { helpText, parseArgs, type ParsedArgs } from "../modules/arguments/index.ts";
import { createServerControl, localServerUrl } from "../modules/server/index.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const packaged = existsSync(join(ROOT, "packages/server/app/standalone.js"));
const launchMode = (): ServerMode => (packaged ? "prod" : readServerMode());
const fallbackUrl = appUrl(configuredAppPort());
const DATA_DIR = join(os.dataHome(), "projector");
const api = createApi(
  () => process.env.PROJECTOR_URL?.replace(/\/+$/, "") || localServerUrl(fallbackUrl),
);

/**
 * The Start Menu hides the console: a launch that fails before the message box leaves no trace.
 * Every hidden launch appends one line here, so the next failure is diagnosable.
 */
function note(line: string): void {
  if (process.env.PROJECTOR_FROM_SHORTCUT !== "1") return;
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    appendFileSync(join(DATA_DIR, "launch.log"), `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* diagnostics must never break the launch */
  }
}
note(`launch ${process.argv.slice(2).join(" ") || "(default)"}`);
process.on("uncaughtException", (error) => {
  note(`uncaught ${error.stack ?? error.message}`);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  note(`unhandled ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
  process.exit(1);
});

function parsedArgs(): ParsedArgs {
  try {
    return parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

const { command, target, options } = parsedArgs();
const out: Output = (line = "") => {
  note(line);
  if (!options.quiet || options.json) console.log(line);
};
const serverControl = createServerControl({
  root: ROOT,
  dataDir: DATA_DIR,
  api,
  packaged,
  launchMode,
  options,
  out,
});

async function version(): Promise<string> {
  try {
    const manifest = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as {
      version?: string;
    };
    return manifest.version || "";
  } catch {
    return "";
  }
}

async function execute(): Promise<void> {
  if (command === "help") {
    console.log(helpText(await version()));
    return;
  }
  if (command === "version") {
    const value = await version();
    if (options.json) out(JSON.stringify({ version: value }, null, 2));
    else out(value || "неизвестно");
    return;
  }
  if (command === "mode") {
    await serverControl.switchMode(target, options);
    return;
  }
  if (options.server) {
    await serverControl.startForegroundServer();
    return;
  }
  if (command === "start") {
    const info = await serverControl.ensureServer();
    if (options.json) out(JSON.stringify(info, null, 2));
    else out(`Projector запущен: ${info.url ?? api.baseUrl}`);
    return;
  }
  if (command === "quit") {
    await commandQuit(api, options, out);
    return;
  }
  if (command === "restart") {
    if (!(await serverControl.health())) {
      const info = await serverControl.ensureServer();
      if (options.json)
        out(JSON.stringify({ server: info, previousPid: null, started: true }, null, 2));
      else out(`Projector запущен: ${info.url ?? api.baseUrl}`);
      return;
    }
    await commandRestart(api, options, out);
    return;
  }
  if (command === "logs") {
    commandLogs(options, out);
    return;
  }
  // Read-only commands stay useful while the server is stopped.
  if (command === "projects") {
    await commandProjects(api, options, out);
    return;
  }
  if (command === "status") {
    await commandStatus(api, options, target, out);
    return;
  }

  // The Start Menu closes the hidden console when this process exits, and the detached server can
  // go with it. A shortcut launch that started the server stays as its invisible supervisor.
  const launchedServer = !(await serverControl.health());
  await serverControl.ensureServer();
  if (command === "open") await commandOpen(api, options, target, out);
  else if (command === "toggle") await commandToggle(api, options, out);
  else if (command === "settings") await commandSettings(api, options, out);
  else if (command === "search") await commandSearch(api, options, target, out);
  else if (command === "run") await commandRun(api, options, target, out);
  else if (command === "stop") await commandStop(api, options, target, out);
  else throw new Error("Неизвестная команда");
  if (launchedServer && process.env.PROJECTOR_FROM_SHORTCUT === "1") await supervise();
}

/** Keeps the hidden launch alive while its server runs; leaves when the server is gone. */
async function supervise(): Promise<void> {
  let misses = 0;
  const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
  for (;;) {
    await sleep(2000);
    if (await api.health()) {
      misses = 0;
      continue;
    }
    if (++misses >= 3) return;
  }
}

execute().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  note(`failed ${message}`);
  serverControl.alertFailure(message);
  process.exit(1);
});
