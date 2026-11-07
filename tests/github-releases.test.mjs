import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.PROJECTOR_SECRET_STORE = "file";

const repository = "octo/project";
const base = `https://api.github.com/repos/${repository}`;

async function setup(token = "") {
  const root = await mkdtemp(join(tmpdir(), "projector-github-releases-"));
  process.env.XDG_DATA_HOME = join(root, "data");
  const { updateIntegration } =
    await import("../packages/server/modules/integration-store/index.ts");
  await updateIntegration("github", () => ({
    enabled: true,
    settings: { directory: join(root, "projects") },
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
    id: 42,
    tag_name: "v1.2.3",
    name: "Project 1.2.3",
    body: "## Changes\n\n- fixed",
    draft: false,
    prerelease: false,
    created_at: "2024-01-01T00:00:00Z",
    published_at: "2024-01-01T00:01:00Z",
    html_url: "https://github.com/octo/project/releases/tag/v1.2.3",
    author: { login: "octocat", avatar_url: "https://github.com/o.png" },
    assets: [
      {
        id: 7,
        name: "app.zip",
        size: 2048,
        download_count: 12,
        content_type: "application/zip",
        state: "uploaded",
        digest: "sha256:abc",
      },
    ],
    ...overrides,
  };
}

test("GitHub releases map tags, assets, the latest mark and the next page", async () => {
  await setup("secret");
  const requests = [];
  mockFetch((address, init) => {
    const url = new URL(address);
    expect(init.headers.Authorization).toBe("Bearer secret");
    if (url.pathname === `${new URL(base).pathname}/releases/latest`)
      return Response.json({ tag_name: "v1.2.2" });
    requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams) });
    if (url.searchParams.get("page") === "2")
      return Response.json(
        Array.from({ length: 30 }, (_, index) =>
          releaseRow({ id: 100 + index, tag_name: `v0.${index}.0`, assets: [] }),
        ),
      );
    return Response.json([
      releaseRow(),
      releaseRow({ id: 41, tag_name: "v1.2.3-rc.1", prerelease: true, draft: true }),
    ]);
  });
  const { browseGithubReleases } = await import("../packages/server/modules/github/index.ts");
  const list = await browseGithubReleases(repository);
  expect(requests[0]).toStrictEqual({
    path: `${new URL(base).pathname}/releases`,
    query: { per_page: "30", page: "1" },
  });
  expect(list.next).toBe(null);
  expect(list.latestTag).toBe("v1.2.2");
  expect(list.releases[0]).toStrictEqual({
    id: "42",
    tag: "v1.2.3",
    name: "Project 1.2.3",
    draft: false,
    prerelease: false,
    upcoming: false,
    author: { login: "octocat", avatarUrl: "https://github.com/o.png" },
    createdAt: "2024-01-01T00:00:00Z",
    releasedAt: "2024-01-01T00:01:00Z",
    htmlUrl: "https://github.com/octo/project/releases/tag/v1.2.3",
    assetCount: 1,
    downloads: 12,
  });
  expect(list.releases[1].draft).toBe(true);
  expect(list.releases[1].prerelease).toBe(true);

  const second = await browseGithubReleases(repository, { page: "2" });
  expect(second.next).toBe(3);
  expect(second.latestTag).toBe("");
  await expect(browseGithubReleases(repository, { page: "0" })).rejects.toThrow(/страница/);
});

test("GitHub release detail returns the body, assets and generated sources", async () => {
  await setup("secret");
  const paths = [];
  mockFetch((address) => {
    const url = new URL(address);
    paths.push(url.pathname);
    return Response.json(releaseRow());
  });
  const { browseGithubRelease } = await import("../packages/server/modules/github/index.ts");
  const detail = await browseGithubRelease(repository, "v1.2.3");
  expect(paths).toStrictEqual([`${new URL(base).pathname}/releases/tags/v1.2.3`]);
  expect(detail.release.tag).toBe("v1.2.3");
  expect(detail.body).toBe("## Changes\n\n- fixed");
  expect(detail.assets.map((asset) => [asset.id, asset.source, asset.external])).toStrictEqual([
    ["7", false, false],
    ["source:zip", true, false],
    ["source:tar.gz", true, false],
  ]);
  expect(detail.assets[0]).toMatchObject({
    name: "app.zip",
    size: 2048,
    downloads: 12,
    contentType: "application/zip",
    uploading: false,
    digest: "sha256:abc",
  });
  expect(detail.assets[0].url).toContain("/api/integrations/github/browse/release-asset?");
  expect(detail.assets[1].url).toContain("/api/integrations/github/browse/release-source?");
  expect(detail.assets[1].url).toContain("format=zip");

  await expect(browseGithubRelease(repository, "")).rejects.toThrow(/тег релиза/);
});

test("GitHub release detail maps missing releases and API failures", async () => {
  await setup();
  let status = 404;
  mockFetch(() => Response.json({}, { status }));
  const { browseGithubRelease } = await import("../packages/server/modules/github/index.ts");
  await expect(browseGithubRelease(repository, "v9")).rejects.toThrow(/Релиз не найден/);
  status = 401;
  await expect(browseGithubRelease(repository, "v9")).rejects.toThrow(/Авторизация GitHub/);
  status = 403;
  await expect(browseGithubRelease(repository, "v9")).rejects.toThrow(/ограничил доступ/);
});

test("GitHub release assets follow a signed URL without the token", async () => {
  await setup("secret");
  const calls = [];
  mockFetch((address, init) => {
    calls.push({ url: String(address), authorization: init.headers.Authorization });
    if (String(address).startsWith("https://api.github.com/"))
      return new Response(null, {
        status: 302,
        headers: { location: "https://objects.example/app.zip" },
      });
    return new Response("zip-bytes", {
      headers: { "content-type": "application/zip", "content-length": "9" },
    });
  });
  const { downloadGithubReleaseAsset } = await import("../packages/server/modules/github/index.ts");
  const download = await downloadGithubReleaseAsset(repository, "7", "app.zip");
  expect(download.name).toBe("app.zip");
  expect(await download.response.text()).toBe("zip-bytes");
  expect(calls[0]).toStrictEqual({
    url: "https://api.github.com/repos/octo/project/releases/assets/7",
    authorization: "Bearer secret",
  });
  expect(calls[1]).toStrictEqual({
    url: "https://objects.example/app.zip",
    authorization: undefined,
  });

  const dirty = await downloadGithubReleaseAsset(repository, "7", 'bad\r\nname"/x');
  expect(dirty.name).toBe("bad__name__x");
  await expect(downloadGithubReleaseAsset(repository, "0", "app.zip")).rejects.toThrow(
    /ассет релиза/,
  );
});

test("GitHub release sources download a tag archive and validate the format", async () => {
  await setup();
  const paths = [];
  mockFetch((address) => {
    paths.push(String(address));
    return new Response("archive", { headers: { "content-type": "application/zip" } });
  });
  const { downloadGithubReleaseSource } =
    await import("../packages/server/modules/github/index.ts");
  const zip = await downloadGithubReleaseSource(repository, "v1/2", "zip");
  expect(zip.name).toBe("project-v1_2.zip");
  expect(zip.contentType).toBe("application/zip");
  expect(paths[0]).toBe("https://api.github.com/repos/octo/project/zipball/v1%2F2");
  await expect(downloadGithubReleaseSource(repository, "v1", "rar")).rejects.toThrow(
    /формат исходников/,
  );
});
