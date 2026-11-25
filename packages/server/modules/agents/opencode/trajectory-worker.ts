import { parentPort, workerData } from "node:worker_threads";
import { HttpError } from "../../http/index.ts";
import {
  readOpenCodeTrajectory,
  type OpenCodeTrajectoryRequest,
  type OpenCodeTrajectoryResult,
} from "./trajectory.ts";

if (parentPort) {
  try {
    const result = readOpenCodeTrajectory(workerData as OpenCodeTrajectoryRequest);
    parentPort.postMessage(result, result.kind === "records" ? [result.json.buffer] : []);
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    const result: OpenCodeTrajectoryResult = {
      kind: "error",
      status: error.status,
      message: error.message,
    };
    parentPort.postMessage(result);
  }
}
