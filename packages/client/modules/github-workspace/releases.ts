import { readRelease, readReleases } from "./client.ts";
import { WORKSPACE_ACTION_UNAVAILABLE } from "../workspace-api/index.ts";

/** Releases of one GitHub repository: a page and one release with its files. */
export function releaseProvider(
  repository: string,
  api: { readReleases?: typeof readReleases; readRelease?: typeof readRelease } = {},
): {
  read(action: string, params: Record<string, string>, signal?: AbortSignal): Promise<unknown>;
} {
  return {
    read(action, params, signal) {
      if (action === "releases")
        return (api.readReleases ?? readReleases)(repository, params, signal);
      if (action !== "release") throw new Error(WORKSPACE_ACTION_UNAVAILABLE);
      const tag = (params.tag || "").trim();
      if (!tag) throw new Error("Укажите тег релиза");
      return (api.readRelease ?? readRelease)(repository, tag, signal);
    },
  };
}
