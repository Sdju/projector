import { expect, test } from "vite-plus/test";
import { createMemoryHistory, createRouter } from "vue-router";
import {
  GITLAB_DEFAULT_INSTANCE,
  gitlabProjectKey,
  gitlabProjectRoute,
  gitlabRepositoryFromRemote,
  normalizeGitlabInstance,
  normalizeGitlabProjectPath,
} from "../modules/gitlab/index.ts";
import { formatProjectRef, parseProjectRef, projectRefSegments } from "../modules/project/index.ts";
import {
  gitlabProjectFromParams,
  projectRoute,
} from "../../client/modules/project/project-route.ts";

test("GitLab instance normalization keeps the authority and rejects unsafe inputs", () => {
  expect(GITLAB_DEFAULT_INSTANCE).toBe("gitlab.com");
  expect(normalizeGitlabInstance("gitlab.com")).toBe("gitlab.com");
  expect(normalizeGitlabInstance(" GitLab.Example.COM:8443 ")).toBe("gitlab.example.com:8443");
  expect(normalizeGitlabInstance("https://gitlab.example.com/")).toBe("gitlab.example.com");
  expect(normalizeGitlabInstance("http://[2001:DB8::1]:8443/")).toBe("[2001:db8::1]:8443");
  for (const value of [
    "",
    "ftp://gitlab.example.com",
    "https://user@gitlab.example.com",
    "https://user:pass@gitlab.example.com",
    "https://gitlab.example.com/group",
    "https://gitlab.example.com/?x=1",
    "https://gitlab.example.com/#top",
    "gitlab.example.com/path",
    "gitlab.example.com?x=1",
    "gitlab.example.com#top",
  ])
    expect(() => normalizeGitlabInstance(value), value).toThrow();
});

test("GitLab project paths normalize links, nested groups and .git", () => {
  expect(normalizeGitlabProjectPath("group/sub/project")).toBe("group/sub/project");
  expect(normalizeGitlabProjectPath("https://gitlab.example.com/group/sub/project")).toBe(
    "group/sub/project",
  );
  expect(
    normalizeGitlabProjectPath(
      "https://gitlab.example.com/group/sub/project/-/tree/main?ref_type=heads#readme",
    ),
  ).toBe("group/sub/project");
  expect(normalizeGitlabProjectPath("group/project.git")).toBe("group/project");
  expect(normalizeGitlabProjectPath("group/project/-/blob/main/README.md")).toBe("group/project");
  expect(
    normalizeGitlabProjectPath("gitlab.example.com/group/project", "https://gitlab.example.com/"),
  ).toBe("group/project");
  expect(
    normalizeGitlabProjectPath(
      "gl:/gitlab.example.com:8443/group/sub/project",
      "https://gitlab.example.com:8443",
    ),
  ).toBe("group/sub/project");
  expect(
    normalizeGitlabProjectPath(
      "https://gitlab.example.com/group/project.git",
      "gitlab.example.com",
    ),
  ).toBe("group/project");

  for (const value of [
    "",
    "project",
    "group/",
    "group//project",
    "group/../project",
    "group/./project",
    "group/.",
    "group/-project",
    "group/.project",
    "group/project.atom",
    "https://gitlab.example.com/group",
  ])
    expect(() => normalizeGitlabProjectPath(value), value).toThrow();
  expect(() =>
    normalizeGitlabProjectPath("https://other.example.com/group/project", "gitlab.example.com"),
  ).toThrow(/другой инстанс/);
  expect(() =>
    normalizeGitlabProjectPath("gl:/other.example.com/group/project", "gitlab.example.com"),
  ).toThrow(/другой инстанс/);
});

test("GitLab routes and project refs round-trip, including a port", () => {
  const route = gitlabProjectRoute("GitLab.Example.com:8443", "group/sub/project.git");
  expect(route).toBe("/gl/projects/gitlab.example.com:8443/group/sub/project");
  expect(gitlabProjectKey("gitlab.example.com:8443", "group/sub/project")).toBe(
    "gl:/gitlab.example.com:8443/group/sub/project",
  );

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/gl/projects/:gitlabPath(.*)+", name: "gitlab-project", component: {} }],
  });
  const resolved = router.resolve(route);
  expect(resolved.name).toBe("gitlab-project");
  expect(resolved.query).toStrictEqual({});
  expect(resolved.hash).toBe("");
  expect(gitlabProjectFromParams(resolved.params.gitlabPath)).toStrictEqual({
    instance: "gitlab.example.com:8443",
    path: "group/sub/project",
  });
  expect(projectRoute("gl:/gitlab.example.com:8443/group/sub/project")).toBe(route);

  const ref = parseProjectRef(gitlabProjectKey("gitlab.com", "group/sub/project"));
  expect(ref).toStrictEqual({
    kind: "gitlab",
    instance: "gitlab.com",
    path: "group/sub/project",
  });
  expect(formatProjectRef(ref)).toBe("gl:/gitlab.com/group/sub/project");
  expect(projectRoute(formatProjectRef(ref))).toBe("/gl/projects/gitlab.com/group/sub/project");
});

test("GitLab remotes map to an instance and a project path", () => {
  const cases = [
    [
      "https://gitlab.com/group/sub/project.git",
      { instance: "gitlab.com", path: "group/sub/project" },
    ],
    ["https://gitlab.com/group/sub/project", { instance: "gitlab.com", path: "group/sub/project" }],
    [
      "http://GitLab.Example.com:8080/team/app.git",
      { instance: "gitlab.example.com:8080", path: "team/app" },
    ],
    ["git://gitlab.com/group/project.git", { instance: "gitlab.com", path: "group/project" }],
    [
      "ssh://git@gitlab.example.com:2222/group/sub/project.git",
      { instance: "gitlab.example.com", path: "group/sub/project" },
    ],
    [
      "ssh://git@gitlab.example.com/group/project",
      { instance: "gitlab.example.com", path: "group/project" },
    ],
    [
      "git@gitlab.example.com:group/sub/project.git",
      { instance: "gitlab.example.com", path: "group/sub/project" },
    ],
    [
      "https://oauth2:never-return@gitlab.com/group/project.git",
      { instance: "gitlab.com", path: "group/project" },
    ],
  ];
  for (const [remote, expected] of cases)
    expect(gitlabRepositoryFromRemote(remote), remote).toStrictEqual(expected);
  for (const remote of [
    "",
    "group/project",
    "ftp://gitlab.example.com/group/project.git",
    "https://gitlab.example.com/group",
    "https://gitlab.example.com/group/../project.git",
    "git@gitlab.example.com:group/../project.git",
    "C:\\projects\\app",
  ])
    expect(gitlabRepositoryFromRemote(remote), remote).toBe(null);
});

test("project refs keep GitLab, GitHub and local forms", () => {
  const gitlab = parseProjectRef("gl:/gitlab.example.com:8443/group/sub/project");
  expect(gitlab).toStrictEqual({
    kind: "gitlab",
    instance: "gitlab.example.com:8443",
    path: "group/sub/project",
  });
  expect(formatProjectRef(gitlab)).toBe("gl:/gitlab.example.com:8443/group/sub/project");
  expect(projectRefSegments(gitlab)).toStrictEqual([
    { name: "gl:/", path: "gl:/" },
    { name: "gitlab.example.com:8443", path: "gl:/gitlab.example.com:8443" },
    { name: "group", path: "gl:/gitlab.example.com:8443/group" },
    { name: "sub", path: "gl:/gitlab.example.com:8443/group/sub" },
    { name: "project", path: "gl:/gitlab.example.com:8443/group/sub/project" },
  ]);
  expect(() => parseProjectRef("gl:/")).not.toThrow();
  expect(parseProjectRef("gl:/gitlab.com")).toStrictEqual({
    kind: "gitlab",
    instance: "gitlab.com",
    path: "",
  });

  const github = parseProjectRef("gh:/owner/repository");
  expect(github).toStrictEqual({ kind: "github", repository: "owner/repository" });
  expect(formatProjectRef(github)).toBe("gh:/owner/repository");
  expect(projectRefSegments(github)).toStrictEqual([
    { name: "gh:/", path: "gh:/" },
    { name: "owner", path: "gh:/owner" },
    { name: "repository", path: "gh:/owner/repository" },
  ]);
  expect(projectRoute("gh:/owner/repository")).toBe("/gh/projects/owner/repository");

  const local = parseProjectRef("/tmp/project");
  expect(local).toStrictEqual({ kind: "local", path: "/tmp/project" });
  expect(formatProjectRef(local)).toBe("/tmp/project");
  expect(projectRefSegments(local).at(-1)).toStrictEqual({
    name: "project",
    path: "/tmp/project",
  });
  expect(projectRoute("/tmp/project")).toBe("/projects/tmp/project");
});
