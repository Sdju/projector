import {
  browseGithubAsset,
  browseGithubCommit,
  browseGithubCommitAsset,
  browseGithubCompareChanges,
  browseGithubCompareFile,
  browseGithubComparison,
  browseGithubDirectories,
  browseGithubDiscussion,
  browseGithubDiscussions,
  browseGithubFile,
  browseGithubIssue,
  browseGithubIssues,
  browseGithubJob,
  browseGithubLog,
  browseGithubPipeline,
  browseGithubPipelines,
  browseGithubPull,
  browseGithubPulls,
  browseGithubRepository,
  browseGithubTree,
} from "../../../modules/github/index.ts";
import { json, type RouteContext } from "../../../modules/transport/index.ts";

/** GitHub readonly browsing; `/browse/...` never falls through to the host actions. */
export async function handleGithubBrowse({
  res,
  url,
  method,
  path,
}: RouteContext): Promise<boolean> {
  if (method !== "GET" || !path.startsWith("/api/integrations/github/browse/")) return false;
  const repository = url.searchParams.get("repository") || "";
  const sha = url.searchParams.get("sha") || "";
  if (path === "/api/integrations/github/browse/directories")
    json(
      res,
      200,
      await browseGithubDirectories(
        url.searchParams.get("path") || "",
        url.searchParams.get("complete") === "true",
      ),
    );
  else if (path === "/api/integrations/github/browse/asset") {
    const commit = url.searchParams.get("commit") || "";
    const asset = commit
      ? await browseGithubCommitAsset(repository, commit, url.searchParams.get("path") || "")
      : await browseGithubAsset(repository, sha, url.searchParams.get("path") || "");
    res.setHeader("Content-Type", asset.mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.end(asset.bytes);
  } else if (path.endsWith("/repository"))
    json(res, 200, await browseGithubRepository(repository, url.searchParams.get("ref") || ""));
  else if (path.endsWith("/tree")) json(res, 200, await browseGithubTree(repository, sha));
  else if (path.endsWith("/file"))
    json(res, 200, await browseGithubFile(repository, sha, url.searchParams.get("path") || ""));
  else if (path.endsWith("/log"))
    json(res, 200, await browseGithubLog(repository, Object.fromEntries(url.searchParams)));
  else if (path.endsWith("/commit"))
    json(res, 200, await browseGithubCommit(repository, url.searchParams.get("hash") || ""));
  else if (path.endsWith("/compare-changes"))
    json(
      res,
      200,
      await browseGithubCompareChanges(
        repository,
        url.searchParams.get("from") || "",
        url.searchParams.get("to") || "",
      ),
    );
  else if (path.endsWith("/compare-file"))
    json(
      res,
      200,
      await browseGithubCompareFile(
        repository,
        url.searchParams.get("from") || "",
        url.searchParams.get("to") || "",
        url.searchParams.get("path") || "",
        url.searchParams.get("originalPath") || undefined,
      ),
    );
  else if (path.endsWith("/commit-diff"))
    json(
      res,
      200,
      await browseGithubComparison(
        repository,
        url.searchParams.get("hash") || "",
        url.searchParams.get("path") || "",
      ),
    );
  else if (path.endsWith("/issues"))
    json(res, 200, await browseGithubIssues(repository, Object.fromEntries(url.searchParams)));
  else if (path.endsWith("/issue"))
    json(res, 200, await browseGithubIssue(repository, Number(url.searchParams.get("number"))));
  else if (path.endsWith("/pulls"))
    json(res, 200, await browseGithubPulls(repository, Object.fromEntries(url.searchParams)));
  else if (path.endsWith("/pull"))
    json(res, 200, await browseGithubPull(repository, Number(url.searchParams.get("number"))));
  else if (path.endsWith("/discussions"))
    json(res, 200, await browseGithubDiscussions(repository, Object.fromEntries(url.searchParams)));
  else if (path.endsWith("/discussion"))
    json(
      res,
      200,
      await browseGithubDiscussion(repository, Number(url.searchParams.get("number"))),
    );
  else if (path.endsWith("/pipelines"))
    json(res, 200, await browseGithubPipelines(repository, Object.fromEntries(url.searchParams)));
  else if (path.endsWith("/pipeline"))
    json(res, 200, await browseGithubPipeline(repository, url.searchParams.get("id") || ""));
  else if (path.endsWith("/job"))
    json(res, 200, await browseGithubJob(repository, url.searchParams.get("id") || ""));
  else return false;
  return true;
}
