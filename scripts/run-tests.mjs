import { spawn } from "node:child_process";

/**
 * `vp test run` with one retry for a dead Vitest worker. The Vite+ dev server the browser fixtures
 * start crashes natively (SIGSEGV/SIGABRT in a rolldown-worker thread) in about 1% of runs; it
 * reproduces without Vitest and on vite-plus 1.1.0, so the run is repeated instead of failing.
 * Real test failures are never retried.
 */
const args = process.argv.slice(2);
const crashed = /Worker exited unexpectedly/;
const failed = /^\s*(FAIL|×)\s|Failed Tests|Tests\s+\d+ failed/m;

function run() {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn("vp", ["test", "run", ...args], { stdio: ["inherit", "pipe", "pipe"] });
    for (const [stream, target] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr],
    ]) {
      stream.on("data", (chunk) => {
        output += chunk;
        target.write(chunk);
      });
    }
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

let result = await run();
if (result.code !== 0 && crashed.test(result.output) && !failed.test(result.output)) {
  console.error("\nA Vitest worker crashed natively (Vite+ dev server); repeating the run once.\n");
  result = await run();
}
process.exit(result.code);
