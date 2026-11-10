import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.PROJECTOR_SECRET_STORE = "file";

const secret = "glpat-navigation-secret";

async function setup(url = "https://gitlab.com", token = "") {
  const root = await mkdtemp(join(tmpdir(), "projector-gitlab-navigation-"));
  process.env.XDG_DATA_HOME = join(root, "data");
  const { updateIntegration } = await import("../modules/integration-store/index.ts");
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
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    expect(init.redirect, "GitLab redirects are forbidden").toBe("error");
    return handler(String(url), init);
  });
}

test("GitLab root hints list groups and projects for a token", async () => {
  await setup("https://gitlab.com", secret);
  const requests = [];
  mockFetch((address, init) => {
    const url = new URL(address);
    requests.push(url);
    expect(url.origin).toBe("https://gitlab.com");
    expect(init.headers["PRIVATE-TOKEN"]).toBe(secret);
    if (url.pathname === "/api/v4/groups") {
      expect(url.searchParams.get("membership")).toBe("true");
      expect(url.searchParams.get("per_page")).toBe("100");
      expect(url.searchParams.get("order_by")).toBe("name");
      return Response.json([
        { id: 1, name: "Beta", full_path: "beta" },
        { id: 2, name: "Alpha", full_path: "alpha" },
      ]);
    }
    if (url.pathname === "/api/v4/projects") {
      expect(url.searchParams.get("membership")).toBe("true");
      expect(url.searchParams.get("per_page")).toBe("100");
      expect(url.searchParams.get("order_by")).toBe("last_activity_at");
      return Response.json([{ name: "App", path_with_namespace: "group/app" }]);
    }
    return Response.json({}, { status: 404 });
  });
  const { browseGitlabDirectories } = await import("../modules/gitlab/index.ts");
  const listing = await browseGitlabDirectories("gl:/gitlab.com", false);
  expect(listing).toStrictEqual({
    path: "gl:/gitlab.com",
    entries: [
      { name: "Alpha", path: "gl:/gitlab.com/alpha" },
      { name: "Beta", path: "gl:/gitlab.com/beta" },
      { name: "App", path: "gl:/gitlab.com/group/app" },
    ],
    truncated: false,
  });
  expect(requests.length).toBe(2);
});

test("GitLab root hints stay public without a token and hide forbidden groups", async () => {
  await setup("https://gitlab.com");
  mockFetch((address, init) => {
    const url = new URL(address);
    expect(init.headers["PRIVATE-TOKEN"]).toBe(undefined);
    if (url.pathname === "/api/v4/groups") {
      expect(url.searchParams.get("membership")).toBe(null);
      return Response.json({}, { status: 403 });
    }
    if (url.pathname === "/api/v4/projects") {
      expect(url.searchParams.get("membership")).toBe(null);
      return Response.json([{ name: "Public", path_with_namespace: "public/app" }]);
    }
    return Response.json({}, { status: 404 });
  });
  const { browseGitlabDirectories } = await import("../modules/gitlab/index.ts");
  expect(await browseGitlabDirectories("gl:/gitlab.com", false)).toStrictEqual({
    path: "gl:/gitlab.com",
    entries: [{ name: "Public", path: "gl:/gitlab.com/public/app" }],
    truncated: false,
  });
});

test("GitLab group hints use the group id for subgroups and projects", async () => {
  await setup("https://gitlab.com", secret);
  const requests = [];
  mockFetch((address) => {
    const url = new URL(address);
    requests.push(`${url.pathname}?${url.searchParams}`);
    if (url.pathname === `/api/v4/groups/${encodeURIComponent("team/sub")}`)
      return Response.json({ id: 10, name: "Sub", full_path: "team/sub" });
    if (url.pathname === "/api/v4/groups/10/subgroups") {
      expect(url.searchParams.get("per_page")).toBe("100");
      expect(url.searchParams.get("page")).toBe("1");
      return Response.json([{ id: 11, name: "Child", full_path: "team/sub/child" }]);
    }
    if (url.pathname === "/api/v4/groups/10/projects") {
      expect(url.searchParams.get("per_page")).toBe("100");
      expect(url.searchParams.get("page")).toBe("1");
      return Response.json([{ name: "App", path_with_namespace: "team/sub/app" }]);
    }
    return Response.json({}, { status: 404 });
  });
  const { browseGitlabDirectories } = await import("../modules/gitlab/index.ts");
  const listing = await browseGitlabDirectories("gl:/gitlab.com/team/sub", false);
  expect(listing).toStrictEqual({
    path: "gl:/gitlab.com/team/sub",
    entries: [
      { name: "Child", path: "gl:/gitlab.com/team/sub/child" },
      { name: "App", path: "gl:/gitlab.com/team/sub/app" },
    ],
    truncated: false,
  });
  expect(
    requests.some((path) => path.startsWith(`/api/v4/groups/${encodeURIComponent("team/sub")}/`)),
  ).toBe(false);
});

test("GitLab complete hints treat the last segment as a prefix of the parent group", async () => {
  await setup("https://gitlab.com", secret);
  mockFetch((address) => {
    const url = new URL(address);
    if (url.pathname === `/api/v4/groups/${encodeURIComponent("group/ap")}`)
      return Response.json({ message: "404 Group Not Found" }, { status: 404 });
    if (url.pathname === `/api/v4/groups/${encodeURIComponent("group")}`)
      return Response.json({ id: 10, name: "Group", full_path: "group" });
    if (url.pathname === "/api/v4/groups/10/subgroups")
      return Response.json([{ id: 11, name: "Archive", full_path: "group/archive" }]);
    if (url.pathname === "/api/v4/groups/10/projects")
      return Response.json([
        { name: "Application", path_with_namespace: "group/application" },
        { name: "App", path_with_namespace: "group/app" },
        { name: "Other", path_with_namespace: "group/other" },
      ]);
    return Response.json({}, { status: 404 });
  });
  const { browseGitlabDirectories } = await import("../modules/gitlab/index.ts");
  const listing = await browseGitlabDirectories("gl:/gitlab.com/group/ap", true);
  expect(listing.entries).toStrictEqual([
    { name: "App", path: "gl:/gitlab.com/group/app" },
    { name: "Application", path: "gl:/gitlab.com/group/application" },
  ]);
  expect(listing.truncated).toBe(false);
});

test("GitLab complete hints fall back to a personal namespace", async () => {
  await setup("https://gitlab.com", secret);
  const requests = [];
  mockFetch((address) => {
    const url = new URL(address);
    requests.push(`${url.pathname}?${url.searchParams}`);
    if (url.pathname.startsWith("/api/v4/groups/"))
      return Response.json({ message: "404 Group Not Found" }, { status: 404 });
    if (url.pathname === "/api/v4/users") {
      expect(url.searchParams.get("username")).toBe("alice");
      return Response.json([{ id: 5, username: "alice" }]);
    }
    if (url.pathname === "/api/v4/users/5/projects") {
      expect(url.searchParams.get("per_page")).toBe("100");
      expect(url.searchParams.get("page")).toBe("1");
      return Response.json([
        { name: "Repo", path_with_namespace: "alice/repo" },
        { name: "Demo", path_with_namespace: "alice/demo" },
      ]);
    }
    return Response.json({}, { status: 404 });
  });
  const { browseGitlabDirectories } = await import("../modules/gitlab/index.ts");
  const listing = await browseGitlabDirectories("gl:/gitlab.com/alice/re", true);
  expect(listing).toStrictEqual({
    path: "gl:/gitlab.com/alice/re",
    entries: [{ name: "Repo", path: "gl:/gitlab.com/alice/repo" }],
    truncated: false,
  });
  expect(
    requests.some((path) => path.startsWith(`/api/v4/groups/${encodeURIComponent("alice/re")}`)),
  ).toBe(true);
  expect(
    requests.some((path) => path.startsWith(`/api/v4/groups/${encodeURIComponent("alice")}?`)),
  ).toBe(true);
});

test("GitLab hints list projects of a personal namespace when its arrow is opened", async () => {
  await setup("https://gitlab.com", secret);
  mockFetch((address) => {
    const url = new URL(address);
    if (url.pathname.startsWith("/api/v4/groups/"))
      return Response.json({ message: "404 Group Not Found" }, { status: 404 });
    if (url.pathname === "/api/v4/users") {
      expect(url.searchParams.get("username")).toBe("alice");
      return Response.json([{ id: 5, username: "alice" }]);
    }
    if (url.pathname === "/api/v4/users/5/projects")
      return Response.json([{ name: "Repo", path_with_namespace: "alice/repo" }]);
    return Response.json({}, { status: 404 });
  });
  const { browseGitlabDirectories } = await import("../modules/gitlab/index.ts");
  expect(await browseGitlabDirectories("gl:/gitlab.com/alice", false)).toStrictEqual({
    path: "gl:/gitlab.com/alice",
    entries: [{ name: "Repo", path: "gl:/gitlab.com/alice/repo" }],
    truncated: false,
  });
});

test("GitLab hints stop at 100 entries and report the next page", async () => {
  await setup("https://gitlab.com", secret);
  mockFetch((address) => {
    const url = new URL(address);
    if (url.pathname === `/api/v4/groups/${encodeURIComponent("big")}`)
      return Response.json({ id: 20, name: "Big", full_path: "big" });
    if (url.pathname === "/api/v4/groups/20/subgroups")
      return Response.json(
        Array.from({ length: 100 }, (_, index) => ({
          id: 1000 + index,
          name: `sub-${index}`,
          full_path: `big/sub-${index}`,
        })),
        { headers: { "X-Next-Page": "2" } },
      );
    if (url.pathname === "/api/v4/groups/20/projects") return Response.json([]);
    return Response.json({}, { status: 404 });
  });
  const { browseGitlabDirectories } = await import("../modules/gitlab/index.ts");
  const listing = await browseGitlabDirectories("gl:/gitlab.com/big", false);
  expect(listing.entries.length).toBe(100);
  expect(listing.entries[0]).toStrictEqual({
    name: "sub-0",
    path: "gl:/gitlab.com/big/sub-0",
  });
  expect(listing.truncated).toBe(true);
});

test("GitLab hints reject foreign hosts and malformed paths before any request", async () => {
  await setup("https://gitlab.com", secret);
  const fetch = mockFetch(() => Response.json({}));
  const { browseGitlabDirectories } = await import("../modules/gitlab/index.ts");
  await expect(
    browseGitlabDirectories("gl:/evil.example.com/group/project", false),
  ).rejects.toMatchObject({ status: 403 });
  for (const path of ["gl:/", "gl:/gitlab.com//group", "gl:/gitlab.com/group/../project"])
    await expect(browseGitlabDirectories(path, false)).rejects.toMatchObject({ status: 400 });
  expect(fetch).not.toHaveBeenCalled();
});

test("fetchPathSuggestions sends gl:/ paths to the GitLab route", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      path: "gl:/gitlab.com/group",
      entries: [{ name: "App", path: "gl:/gitlab.com/group/app" }],
      truncated: false,
    }),
  );
  try {
    const { fetchPathSuggestions } = await import("../../client/modules/project/api/client.ts");
    const listing = await fetchPathSuggestions("gl:/gitlab.com/group/ap", true);
    expect(String(fetch.mock.calls[0][0])).toBe(
      `/api/integrations/gitlab/browse/directories?${new URLSearchParams({
        path: "gl:/gitlab.com/group/ap",
        complete: "true",
      })}`,
    );
    expect(listing.entries).toStrictEqual([{ name: "App", path: "gl:/gitlab.com/group/app" }]);
  } finally {
    fetch.mockRestore();
  }
});

test("ide.gitlab.repository.open normalizes references into the GitLab route", async () => {
  const { gitlabOpenRoute } = await import("../../client/modules/project/index.ts");
  expect(gitlabOpenRoute("gl:/gitlab.com/group/sub/app")).toBe(
    "/gl/projects/gitlab.com/group/sub/app",
  );
  expect(gitlabOpenRoute("gitlab.com/group/app")).toBe("/gl/projects/gitlab.com/group/app");
  expect(gitlabOpenRoute("group/app", "https://gitlab.com")).toBe(
    "/gl/projects/gitlab.com/group/app",
  );
  expect(gitlabOpenRoute("group/app", "https://git.example.com/gitlab")).toBe(
    "/gl/projects/git.example.com/group/app",
  );
  expect(
    gitlabOpenRoute(
      "https://git.example.com/gitlab/team/app/-/tree/main",
      "https://git.example.com/gitlab",
    ),
  ).toBe("/gl/projects/git.example.com/team/app");
  expect(gitlabOpenRoute("git.example.com:8443/team/app", "https://git.example.com:8443")).toBe(
    "/gl/projects/git.example.com:8443/team/app",
  );
  expect(() => gitlabOpenRoute("gl:/")).toThrow(/group\/project/);
  expect(() => gitlabOpenRoute("group")).toThrow(/group\/project/);
});
