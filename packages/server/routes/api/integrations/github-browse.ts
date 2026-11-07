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
  browseGithubIcon,
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
import { json, type RouteDefinition } from "../../../modules/transport/index.ts";
import { letterIconSvg } from "../../../modules/projects/index.ts";
import { sendIconBytes } from "../../../modules/project-presentation/index.ts";

/** GitHub readonly browsing; `/browse/...` never falls through to the host actions. */
export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/integrations/github/browse/directories",
    handler: async ({ res, url }) => {
      json(
        res,
        200,
        await browseGithubDirectories(
          url.searchParams.get("path") || "",
          url.searchParams.get("complete") === "true",
        ),
      );
    },
  },
  {
    method: "GET",
    path: "/api/integrations/github/browse/icon",
    handler: async ({ res, url }) => {
      const repository = url.searchParams.get("repository") || "";
      const icon = await browseGithubIcon(repository, url.searchParams.get("ref") || "").catch(
        () => null,
      );
      const name = repository.split("/").filter(Boolean).at(-1) || "GitHub";
      sendIconBytes(
        res,
        icon?.mime ?? "image/svg+xml",
        icon?.bytes ?? Buffer.from(letterIconSvg(name)),
      );
    },
  },
  {
    method: "GET",
    path: "/api/integrations/github/browse/asset",
    handler: async ({ res, url }) => {
      const repository = url.searchParams.get("repository") || "";
      const sha = url.searchParams.get("sha") || "";
      const commit = url.searchParams.get("commit") || "";
      const asset = commit
        ? await browseGithubCommitAsset(repository, commit, url.searchParams.get("path") || "")
        : await browseGithubAsset(repository, sha, url.searchParams.get("path") || "");
      res.setHeader("Content-Type", asset.mime);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.end(asset.bytes);
    },
  },
  {
    method: "GET",
    path: "/api/integrations/github/browse/repository",
    handler: async ({ res, url }) => {
      json(
        res,
        200,
        await browseGithubRepository(
          url.searchParams.get("repository") || "",
          url.searchParams.get("ref") || "",
        ),
      );
    },
  },
  {
    method: "GET",
    path: "/api/integrations/github/browse/tree",
    handler: async ({ res, url }) => {
      json(
        res,
        200,
        await browseGithubTree(
          url.searchParams.get("repository") || "",
          url.searchParams.get("sha") || "",
        ),
      );
    },
  },
  {
    method: "GET",
    path: "/api/integrations/github/browse/file",
    handler: async ({ res, url }) => {
      json(
        res,
        200,
        await browseGithubFile(
          url.searchParams.get("repository") || "",
          url.searchParams.get("sha") || "",
          url.searchParams.get("path") || "",
        ),
      );
    },
  },
  {
    method: "GET",
    path: "/api/integrations/github/browse/log",
    handler: async ({ res, url }) => {
      json(
        res,
        200,
        await browseGithubLog(
          url.searchParams.get("repository") || "",
          Object.fromEntries(url.searchParams),
        ),
      );
    },
  },
  {
    method: "GET",
    path: "/api/integrations/github/browse/commit",
    handler: async ({ res, url }) => {
      json(
        res,
        200,
        await browseGithubCommit(
          url.searchParams.get("repository") || "",
          url.searchParams.get("hash") || "",
        ),
      );
    },
  },
  {
    method: "GET",
    path: "/api/integrations/github/browse/compare-changes",
    handler: async ({ res, url }) => {
      json(
        res,
        200,
        await browseGithubCompareChanges(
          url.searchParams.get("repository") || "",
          url.searchParams.get("from") || "",
          url.searchParams.get("to") || "",
        ),
      );
    },
  },
  {
    method: "GET",
    path: "/api/integrations/github/browse/compare-file",
    handler: async ({ res, url }) => {
      json(
        res,
        200,
        await browseGithubCompareFile(
          url.searchParams.get("repository") || "",
          url.searchParams.get("from") || "",
          url.searchParams.get("to") || "",
          url.searchParams.get("path") || "",
          url.searchParams.get("originalPath") || undefined,
        ),
      );
    },
  },
  {
    method: "GET",
    path: "/api/integrations/github/browse/commit-diff",
    handler: async ({ res, url }) => {
      json(
        res,
        200,
        await browseGithubComparison(
          url.searchParams.get("repository") || "",
          url.searchParams.get("hash") || "",
          url.searchParams.get("path") || "",
        ),
      );
    },
  },
  {
    method: "GET",
    path: "/api/integrations/github/browse/issues",
    handler: async ({ res, url }) => {
      json(
        res,
        200,
        await browseGithubIssues(
          url.searchParams.get("repository") || "",
          Object.fromEntries(url.searchParams),
        ),
      );
    },
  },
  {
    method: "GET",
    path: "/api/integrations/github/browse/issue",
    handler: async ({ res, url }) => {
      json(
        res,
        200,
        await browseGithubIssue(
          url.searchParams.get("repository") || "",
          Number(url.searchParams.get("number")),
        ),
      );
    },
  },
  {
    method: "GET",
    path: "/api/integrations/github/browse/pulls",
    handler: async ({ res, url }) => {
      json(
        res,
        200,
        await browseGithubPulls(
          url.searchParams.get("repository") || "",
          Object.fromEntries(url.searchParams),
        ),
      );
    },
  },
  {
    method: "GET",
    path: "/api/integrations/github/browse/pull",
    handler: async ({ res, url }) => {
      json(
        res,
        200,
        await browseGithubPull(
          url.searchParams.get("repository") || "",
          Number(url.searchParams.get("number")),
        ),
      );
    },
  },
  {
    method: "GET",
    path: "/api/integrations/github/browse/discussions",
    handler: async ({ res, url }) => {
      json(
        res,
        200,
        await browseGithubDiscussions(
          url.searchParams.get("repository") || "",
          Object.fromEntries(url.searchParams),
        ),
      );
    },
  },
  {
    method: "GET",
    path: "/api/integrations/github/browse/discussion",
    handler: async ({ res, url }) => {
      json(
        res,
        200,
        await browseGithubDiscussion(
          url.searchParams.get("repository") || "",
          Number(url.searchParams.get("number")),
        ),
      );
    },
  },
  {
    method: "GET",
    path: "/api/integrations/github/browse/pipelines",
    handler: async ({ res, url }) => {
      json(
        res,
        200,
        await browseGithubPipelines(
          url.searchParams.get("repository") || "",
          Object.fromEntries(url.searchParams),
        ),
      );
    },
  },
  {
    method: "GET",
    path: "/api/integrations/github/browse/pipeline",
    handler: async ({ res, url }) => {
      json(
        res,
        200,
        await browseGithubPipeline(
          url.searchParams.get("repository") || "",
          url.searchParams.get("id") || "",
        ),
      );
    },
  },
  {
    method: "GET",
    path: "/api/integrations/github/browse/job",
    handler: async ({ res, url }) => {
      json(
        res,
        200,
        await browseGithubJob(
          url.searchParams.get("repository") || "",
          url.searchParams.get("id") || "",
        ),
      );
    },
  },
];
