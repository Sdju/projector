import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

/**
 * Serve Vue browser fixtures from a Vite server in a child process, without Projector's production
 * API, PTYs or instance state. `pages` maps a route to its HTML; `responses` are fixed replies
 * ({equals|startsWith|includes, status, type, body}). A native crash of the dev server then fails
 * one attempt of the test (give such tests `retry`) instead of killing the Vitest worker.
 */
export async function createBrowserFixture({ pages, responses = [] }) {
  const directory = await mkdtemp(join(tmpdir(), "projector-browser-fixture-"));
  const child = spawn(
    process.execPath,
    [new URL("./browser-server-process.mjs", import.meta.url).pathname],
    {
      env: {
        ...process.env,
        PROJECTOR_FIXTURE: JSON.stringify({ pages, responses }),
        PROJECTOR_FIXTURE_DIR: join(directory, "server"),
      },
      stdio: ["pipe", "pipe", "inherit"],
    },
  );
  const exited = new Promise((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const next = async (prefix) => {
    const outcome = await Promise.race([lines.next(), exited]);
    if (!("value" in outcome) || !outcome.value?.startsWith(prefix))
      throw new Error(`Browser fixture server died (${JSON.stringify(outcome)})`);
    return outcome.value;
  };
  let port = Number((await next("ready ")).split(" ")[1]);
  return {
    directory,
    get base() {
      return `http://127.0.0.1:${port}`;
    },
    url(route) {
      return `${this.base}${route}`;
    },
    /** Restart the Vite server in place (an in-process Vite restart). */
    async restart() {
      child.stdin.write("restart\n");
      port = Number((await next("restarted ")).split(" ")[1]);
    },
    async close() {
      if (child.exitCode === null && child.signalCode === null) {
        child.stdin.write("close\n");
        const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
        await exited;
        clearTimeout(timer);
      }
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}
