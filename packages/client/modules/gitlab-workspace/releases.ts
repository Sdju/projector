import { readRelease, readReleases } from "./client.ts";

const UNAVAILABLE = "Действие недоступно для этого источника workspace";

/** Releases of one GitLab project: a page and one release with its links and sources. */
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
      if (action !== "release") throw new Error(UNAVAILABLE);
      const tag = (params.tag || "").trim();
      if (!tag) throw new Error("Укажите тег релиза");
      return (api.readRelease ?? readRelease)(repository, tag, signal);
    },
  };
}
