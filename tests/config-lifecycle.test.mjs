import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "vite-plus/test";

test("reloading the actual config does not accumulate process exit hooks", async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { loadConfigFromFile } from "vite-plus";
    const before = process.listenerCount("exit");
    for (let i = 0; i < 3; i++) {
      await loadConfigFromFile({ command: "serve", mode: "development" });
    }
    console.log(JSON.stringify({ before, after: process.listenerCount("exit") }));
  `,
    ],
    { cwd: new URL("..", import.meta.url), timeout: 45000 },
  );
  const result = JSON.parse(stdout.trim().split("\n").at(-1));
  expect(result.after).toBe(result.before);
});
