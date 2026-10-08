import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createConfig } from "@o-feod/oxlint-structure-plugin/configs";
import feodConfig from "../feod.config.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const oxlint = join(projectRoot, "node_modules/.bin/oxlint");
const plugin = fileURLToPath(import.meta.resolve("@o-feod/oxlint-structure-plugin"));

/** Run only the FEOD rules over the configured roots; policy lives in feod.config.mjs. */
export function checkFeod({ rootDir = projectRoot, config = feodConfig } = {}) {
  const run = prepare(rootDir, config);
  if (!run) return [];
  try {
    const result = spawnSync(oxlint, run.args, {
      cwd: rootDir,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    return diagnosticsOf(result.status, result.stdout, result.stderr);
  } finally {
    rmSync(run.directory, { recursive: true, force: true });
  }
}

/**
 * The same check without blocking the caller's event loop and with a deadline. A dev server runs
 * it beside itself: a slow or crashed oxlint must cost a log line, never the server.
 */
export function checkFeodAsync({
  rootDir = projectRoot,
  config = feodConfig,
  timeoutMs = 60_000,
} = {}) {
  const run = prepare(rootDir, config);
  if (!run) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const child = spawn(oxlint, run.args, { cwd: rootDir, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (action) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rmSync(run.directory, { recursive: true, force: true });
      action();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new Error(`oxlint не завершился за ${timeoutMs / 1000} с`)));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (status) =>
      finish(() => {
        try {
          resolve(diagnosticsOf(status, stdout, stderr));
        } catch (error) {
          reject(error);
        }
      }),
    );
  });
}

function prepare(rootDir, config) {
  const feod = createConfig(config, { rootDir });
  const roots = Object.keys(config.roots).filter((root) => existsSync(join(rootDir, root)));
  if (!roots.length) return undefined;
  const directory = mkdtempSync(join(tmpdir(), "projector-feod-"));
  const file = join(directory, "oxlint.json");
  writeFileSync(
    file,
    JSON.stringify({
      categories: { correctness: "off" },
      jsPlugins: [{ name: "feod-structure", specifier: plugin }],
      rules: feod.rules,
    }),
  );
  return { directory, args: ["-c", file, "-f", "json", ...roots] };
}

function diagnosticsOf(status, stdout, stderr) {
  let diagnostics;
  try {
    diagnostics = JSON.parse(stdout).diagnostics;
  } catch {
    throw new Error(`oxlint failed (${status}): ${stderr || stdout}`);
  }
  return diagnostics
    .filter((item) => item.code?.startsWith("feod-structure("))
    .map((item) => ({
      file: item.filename,
      rule: item.code.slice(15, -1),
      message: item.message,
    }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const errors = checkFeod();
  if (errors.length) {
    console.error(errors.map((item) => `${item.file}: ${item.message} [${item.rule}]`).join("\n"));
    process.exitCode = 1;
  } else console.log("FEOD: boundaries, entries, cycles and size limits checked.");
}
