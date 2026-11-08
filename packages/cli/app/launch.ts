import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { os } from "@projector/core/modules/os/index.ts";
import { readServerMode } from "@projector/core/modules/app-paths/index.ts";
import type { ServerMode } from "@projector/core/modules/server-mode/index.ts";
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
import { createServerControl } from "../modules/server/index.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const packaged = existsSync(join(ROOT, "packages/server/app/standalone.js"));
const launchMode = (): ServerMode => (packaged ? "prod" : readServerMode());
const APP_URL = (process.env.PROJECTOR_URL || "http://localhost:4177").replace(/\/+$/, "");
const DATA_DIR = join(os.dataHome(), "projector");
const api = createApi(APP_URL);

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
  if (!options.quiet || options.json) console.log(line);
};
const serverControl = createServerControl({
  root: ROOT,
  dataDir: DATA_DIR,
  appUrl: APP_URL,
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
    else out(`Projector запущен: ${info.url ?? APP_URL}`);
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
      else out(`Projector запущен: ${info.url ?? APP_URL}`);
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

  await serverControl.ensureServer();
  if (command === "open") await commandOpen(api, options, target, out);
  else if (command === "toggle") await commandToggle(api, options, out);
  else if (command === "settings") await commandSettings(api, options, out);
  else if (command === "search") await commandSearch(api, options, target, out);
  else if (command === "run") await commandRun(api, options, target, out);
  else if (command === "stop") await commandStop(api, options, target, out);
  else throw new Error("Неизвестная команда");
}

execute().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  serverControl.alertFailure(message);
  process.exit(1);
});
