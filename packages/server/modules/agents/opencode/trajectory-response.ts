import { Worker } from "node:worker_threads";
import { HttpError } from "../../http/index.ts";
import type { OpenCodeTrajectoryRequest, OpenCodeTrajectoryResult } from "./trajectory.ts";

export async function loadOpenCodeTrajectory(
  request: OpenCodeTrajectoryRequest,
  signal: AbortSignal,
): Promise<Exclude<OpenCodeTrajectoryResult, { kind: "error" }>> {
  signal.throwIfAborted();
  const worker = new Worker(new URL("./trajectory-worker.ts", import.meta.url), {
    workerData: request,
    // The entry and its imports are ordinary Node modules, also in Vite dev and Vitest.
    execArgv: [],
  });
  const abort = () => void worker.terminate();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const result = await new Promise<OpenCodeTrajectoryResult>((resolve, reject) => {
      worker.once("message", resolve);
      worker.once("error", reject);
      worker.once("exit", (code) =>
        reject(signal.reason ?? new Error(`Чтение траектории OpenCode прервалось (${code})`)),
      );
    });
    signal.throwIfAborted();
    if (result.kind === "error") throw new HttpError(result.status, result.message);
    return result;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
