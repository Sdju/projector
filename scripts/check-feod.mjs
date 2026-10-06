import { spawnSync } from "node:child_process";
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
  const feod = createConfig(config, { rootDir });
  const directory = mkdtempSync(join(tmpdir(), "projector-feod-"));
  try {
    const file = join(directory, "oxlint.json");
    writeFileSync(
      file,
      JSON.stringify({
        categories: { correctness: "off" },
        jsPlugins: [{ name: "feod-structure", specifier: plugin }],
        rules: feod.rules,
      }),
    );
    const roots = Object.keys(config.roots).filter((root) => existsSync(join(rootDir, root)));
    if (!roots.length) return [];
    const result = spawnSync(oxlint, ["-c", file, "-f", "json", ...roots], {
      cwd: rootDir,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    let diagnostics;
    try {
      diagnostics = JSON.parse(result.stdout).diagnostics;
    } catch {
      throw new Error(`oxlint failed (${result.status}): ${result.stderr || result.stdout}`);
    }
    return diagnostics
      .filter((item) => item.code?.startsWith("feod-structure("))
      .map((item) => ({
        file: item.filename,
        rule: item.code.slice(15, -1),
        message: item.message,
      }));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const errors = checkFeod();
  if (errors.length) {
    console.error(errors.map((item) => `${item.file}: ${item.message} [${item.rule}]`).join("\n"));
    process.exitCode = 1;
  } else console.log("FEOD: boundaries, entries, cycles and size limits checked.");
}
