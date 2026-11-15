import { readJob, readPipeline, readPipelines } from "./client.ts";
import { WORKSPACE_ACTION_UNAVAILABLE } from "../workspace-api/index.ts";

/** Workflow runs, a run with its jobs, and one job with its log. */
export function pipelineProvider(
  repository: string,
  api: {
    readPipelines?: typeof readPipelines;
    readPipeline?: typeof readPipeline;
    readJob?: typeof readJob;
  } = {},
): {
  read(action: string, params: Record<string, string>, signal?: AbortSignal): Promise<unknown>;
} {
  return {
    read(action, params, signal) {
      if (action === "pipelines")
        return (api.readPipelines ?? readPipelines)(repository, params, signal);
      if (action !== "pipeline" && action !== "job") throw new Error(WORKSPACE_ACTION_UNAVAILABLE);
      const id = Number(params.id);
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Укажите номер записи CI");
      if (action === "pipeline") return (api.readPipeline ?? readPipeline)(repository, id, signal);
      return (api.readJob ?? readJob)(repository, id, signal);
    },
  };
}
