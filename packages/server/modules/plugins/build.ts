import { exec } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const BUILD_TIMEOUT_MS = 120_000;
const OUTPUT_LIMIT = 4_000;

function tail(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > OUTPUT_LIMIT ? trimmed.slice(-OUTPUT_LIMIT) : trimmed;
}

/** Runs the package's own `projector.build` in its source folder; the action is always user-initiated. */
export async function buildPluginSource(source: string): Promise<void> {
  const raw = await readFile(join(source, "package.json"), "utf8");
  const pkg = JSON.parse(raw) as { projector?: { build?: unknown } };
  const command = pkg.projector?.build;
  if (typeof command !== "string" || !command.trim())
    throw new Error("В манифесте нет projector.build");
  await new Promise<void>((resolve, reject) => {
    exec(
      command,
      {
        cwd: source,
        timeout: BUILD_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, CI: "1", NO_COLOR: "1" },
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }
        const output = tail(`${stdout}${stderr}`);
        reject(new Error(output ? `Сборка плагина не удалась: ${output}` : error.message));
      },
    );
  });
}
