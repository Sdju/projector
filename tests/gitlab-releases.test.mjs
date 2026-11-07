import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.PROJECTOR_SECRET_STORE = "file";

const repository = "gitlab.com/group/project";
const id = encodeURIComponent("group/project");

async function setup(url = "https://gitlab.com", token = "") {
  const root = await mkdtemp(join(tmpdir(), "projector-gitlab-releases-"));
  process.env.XDG_DATA_HOME = join(root, "data");
  const { updateIntegration } =
    await import("../packages/server/modules/integration-store/index.ts");
  await updateIntegration("gitlab", () => ({
    enabled: true,
    settings: { url, directory: join(root, "projects") },
    credentials: token ? { token, login: "tester" } : {},
  }));
  onTestFinished(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });
}

function mockFetch(handler) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (address, init) => {
    const url =
      address instanceof URL ? address.href : typeof address === "string" ? address : address.url;
    return handler(url, init);
  });
}

function releaseRow(overrides = {}) {
  return {
    name: "Project 1.2.3",
    tag_name: "v1.2.3",
    description: "## Changes\n\n- fixed",
    created_at: "2024-01-01T00:00:00Z",
    released_at: "2024-01-01T00:01:00Z",
    upcoming_release: false,
    author: { username: "tanuki", avatar_url: "https://gitlab.com/a.png" },
    assets: {
      count: 3,
      links: [
        {
          id: 9,
          name: "Linux",
          url: "https://example.test/download",
          direct_asset_url: "https://example.test/download/direct",
          link_type: "package",
          external: true,
        },
      ],
      sources: [
        {
          format: "zip",
          url: "https://gitlab.com/group/project/-/archive/v1.2.3/project-v1.2.3.zip",
        },
        {
          format: "tar.gz",
          url: "https://gitlab.com/group/project/-/archive/v1.2.3/project-v1.2.3.tar.gz",
        },
      ],
    },
    ...overrides,
  };
}

test("GitLab releases map tags, links, sources and the latest released tag", async () => {
  await setup();
  const requests = [];
  mockFetch((address) => {
    const url = new URL(address);
    requests.push(`${url.pathname}?${url.searchParams}`);
    return Response.json(
      [
        releaseRow({
          tag_name: "v2.0.0",
          upcoming_release: true,
          assets: { count: 0, links: [], sources: [] },
        }),
        releaseRow(),
      ],
      { headers: { "X-Next-Page": "2" } },
    );
  });
  const { browseGitlabReleases } = await import("../packages/server/modules/gitlab/index.ts");
  const list = await browseGitlabReleases(repository);
  expect(requests[0]).toBe(`/api/v4/projects/${id}/releases?per_page=30&page=1`);
  expect(list.next).toBe(2);
  expect(list.latestTag).toBe("v1.2.3");
  expect(list.releases[0]).toMatchObject({
    id: "v2.0.0",
    tag: "v2.0.0",
    upcoming: true,
    assetCount: 0,
    downloads: null,
  });
  expect(list.releases[1]).toStrictEqual({
    id: "v1.2.3",
    tag: "v1.2.3",
    name: "Project 1.2.3",
    draft: false,
    prerelease: false,
    upcoming: false,
    author: { login: "tanuki", avatarUrl: "https://gitlab.com/a.png" },
    createdAt: "2024-01-01T00:00:00Z",
    releasedAt: "2024-01-01T00:01:00Z",
    htmlUrl: "https://gitlab.com/group/project/-/releases/v1.2.3",
    assetCount: 1,
    downloads: null,
  });
  await expect(browseGitlabReleases(repository, { page: "0" })).rejects.toThrow(/страница/);
});

test("GitLab release detail returns the description, links and sources", async () => {
  await setup();
  const paths = [];
  mockFetch((address) => {
    const url = new URL(address);
    paths.push(url.pathname);
    return Response.json(releaseRow());
  });
  const { browseGitlabRelease } = await import("../packages/server/modules/gitlab/index.ts");
  const detail = await browseGitlabRelease(repository, "v1.2.3");
  expect(paths).toStrictEqual([`/api/v4/projects/${id}/releases/v1.2.3`]);
  expect(detail.release.tag).toBe("v1.2.3");
  expect(detail.body).toBe("## Changes\n\n- fixed");
  expect(detail.assets.map((asset) => [asset.id, asset.external, asset.source])).toStrictEqual([
    ["link:9", true, false],
    ["source:zip", false, true],
    ["source:tar.gz", false, true],
  ]);
  expect(detail.assets[0]).toMatchObject({
    name: "Linux",
    url: "https://example.test/download/direct",
    size: null,
    downloads: null,
  });
  expect(detail.assets[1].url).toContain("/api/integrations/gitlab/browse/release-source?");
  expect(detail.assets[1].url).toContain("format=zip");

  await expect(browseGitlabRelease(repository, "")).rejects.toThrow(/тег релиза/);
});

test("GitLab release detail maps a missing release", async () => {
  await setup();
  mockFetch(() => Response.json({}, { status: 404 }));
  const { browseGitlabRelease } = await import("../packages/server/modules/gitlab/index.ts");
  await expect(browseGitlabRelease(repository, "v9")).rejects.toThrow(/Релиз не найден/);
});

test("GitLab release sources download with the project token and drop it on a redirect", async () => {
  await setup("https://gitlab.com", "secret");
  const calls = [];
  mockFetch((address, init) => {
    const url = String(address);
    calls.push({ url, token: init.headers["PRIVATE-TOKEN"] });
    if (url.endsWith("/releases/v1.2.3")) return Response.json(releaseRow());
    if (url.startsWith("https://gitlab.com/"))
      return new Response(null, {
        status: 302,
        headers: { location: "https://cdn.example/project.zip" },
      });
    return new Response("archive", { headers: { "content-type": "application/zip" } });
  });
  const { downloadGitlabReleaseSource } =
    await import("../packages/server/modules/gitlab/index.ts");
  const download = await downloadGitlabReleaseSource(repository, "v1.2.3", "zip");
  expect(download.name).toBe("project-v1.2.3.zip");
  expect(await download.response.text()).toBe("archive");
  expect(calls.at(-2)).toMatchObject({
    url: "https://gitlab.com/group/project/-/archive/v1.2.3/project-v1.2.3.zip",
    token: "secret",
  });
  expect(calls.at(-1)).toStrictEqual({
    url: "https://cdn.example/project.zip",
    token: undefined,
  });
  await expect(downloadGitlabReleaseSource(repository, "v1.2.3", "rar")).rejects.toThrow(
    /формат исходников/,
  );
});
