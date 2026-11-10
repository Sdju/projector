import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Never touch the real OS keyring from tests.
process.env.PROJECTOR_SECRET_STORE = "file";

const base = "https://git.example.com";
const clientId = "projector-client";
const access = "oauth-access-never-return";
const refreshed = "oauth-refreshed-never-return";
const pat = "glpat-never-return";

async function sandbox(credentials = {}, settings = {}) {
  const root = await mkdtemp(join(tmpdir(), "projector-gitlab-oauth-"));
  process.env.XDG_DATA_HOME = join(root, "data");
  const { updateIntegration } = await import("../modules/integration-store/index.ts");
  await updateIntegration("gitlab", () => ({
    enabled: true,
    settings: { url: base, clientId, directory: join(root, "projects"), ...settings },
    credentials,
  }));
  onTestFinished(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

function form(init) {
  return new URLSearchParams(String(init.body));
}

function advance(seconds) {
  vi.setSystemTime(Date.now() + seconds * 1000);
}

function oauthCredentials(overrides = {}) {
  return {
    kind: "oauth",
    token: access,
    refreshToken: "refresh-1",
    expiresAt: String(Date.now() + 3_600_000),
    login: "tanuki",
    ...overrides,
  };
}

function mockSequence(handler) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    expect(init.redirect, "GitLab redirects are forbidden").toBe("error");
    return handler(String(url), init);
  });
}

test("GitLab settings save Client ID and reset credentials when the instance changes", async () => {
  const root = await sandbox({ token: pat, login: "tester" }, { clientId: "" });
  const { configureGitlab } = await import("../modules/gitlab/index.ts");
  const saved = await configureGitlab({
    enabled: true,
    url: base,
    clientId,
    directory: join(root, "other"),
  });
  expect(saved).toMatchObject({
    connected: true,
    auth: "pat",
    account: "tester",
    settings: { clientId, url: base, directory: join(root, "other") },
  });
  const moved = await configureGitlab({
    enabled: true,
    url: "https://other.example.com",
    clientId,
    directory: join(root, "other"),
  });
  expect(moved.connected).toBe(false);
  expect(moved.settings.url).toBe("https://other.example.com");
});

test("Device Flow starts with the configured client, scopes and form encoding", async () => {
  const root = await sandbox({}, { clientId });
  let mode = "ok";
  const calls = [];
  mockSequence((address, init) => {
    calls.push(address);
    expect(address).toBe(`${base}/oauth/authorize_device`);
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = form(init);
    expect(body.get("client_id")).toBe(clientId);
    expect(body.get("scope")).toBe("read_api read_repository read_user");
    if (mode === "invalid") return Response.json({ error: "invalid_client" }, { status: 400 });
    return Response.json({
      device_code: "device-1",
      user_code: "ABCD-EFGH",
      verification_uri: `${base}/-/device`,
      expires_in: 300,
      interval: 5,
    });
  });
  const { beginGitlabLogin } = await import("../modules/gitlab/index.ts");
  const login = await beginGitlabLogin();
  expect(login).toMatchObject({
    userCode: "ABCD-EFGH",
    verificationUri: `${base}/-/device`,
    interval: 5,
  });
  expect(calls).toHaveLength(1);

  const { updateIntegration } = await import("../modules/integration-store/index.ts");
  await updateIntegration("gitlab", (config) => ({
    ...config,
    settings: { ...config.settings, directory: join(root, "projects"), clientId: "" },
  }));
  await expect(beginGitlabLogin()).rejects.toMatchObject({
    status: 400,
    message: /Client ID/,
  });
  expect(calls).toHaveLength(1);

  await updateIntegration("gitlab", (config) => ({
    ...config,
    settings: { ...config.settings, clientId },
  }));
  mode = "invalid";
  await expect(beginGitlabLogin()).rejects.toMatchObject({ status: 400 });
});

test("Device Flow polls pending and stores an OAuth credential after Bearer /user", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  await sandbox({}, { clientId });
  let tokenPolls = 0;
  const polls = [];
  mockSequence((address, init) => {
    if (address === `${base}/oauth/authorize_device`)
      return Response.json({
        device_code: "device-2",
        user_code: "IJKL-MNOP",
        verification_uri: `${base}/-/device`,
        expires_in: 300,
        interval: 5,
      });
    if (address === `${base}/oauth/token`) {
      tokenPolls++;
      const body = form(init);
      expect(body.get("client_id")).toBe(clientId);
      expect(body.get("device_code")).toBe("device-2");
      expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:device_code");
      polls.push(body);
      if (tokenPolls === 1) return Response.json({ error: "authorization_pending" });
      return Response.json({
        access_token: access,
        refresh_token: "refresh-2",
        expires_in: 3600,
        token_type: "Bearer",
      });
    }
    if (address === `${base}/api/v4/user`) {
      expect(init.headers.Authorization).toBe(`Bearer ${access}`);
      expect(init.headers["PRIVATE-TOKEN"]).toBe(undefined);
      return Response.json({ username: "tanuki" });
    }
    return Response.json({}, { status: 404 });
  });
  const { beginGitlabLogin, pollGitlabLogin } = await import("../modules/gitlab/index.ts");
  const login = await beginGitlabLogin();
  // The interval is enforced locally, so the first poll does not touch the network.
  expect(await pollGitlabLogin({ id: login.id })).toStrictEqual({ pending: true, interval: 5 });
  expect(tokenPolls).toBe(0);

  advance(5.1);
  expect(await pollGitlabLogin({ id: login.id })).toStrictEqual({ pending: true, interval: 5 });
  expect(tokenPolls).toBe(1);

  advance(5.1);
  const result = await pollGitlabLogin({ id: login.id });
  expect(result.pending).toBe(false);
  expect(result.integration).toMatchObject({
    connected: true,
    account: "tanuki",
    auth: "oauth",
    settings: { clientId },
  });
  expect(JSON.stringify(result)).not.toContain(access);
  expect(JSON.stringify(result)).not.toContain("refresh-2");

  const { integrationConfig } = await import("../modules/integration-store/index.ts");
  const stored = await integrationConfig("gitlab");
  expect(stored.credentials.kind).toBe("oauth");
  expect(stored.credentials.token).toBe(access);
  expect(stored.credentials.refreshToken).toBe("refresh-2");
  expect(stored.credentials.login).toBe("tanuki");
  expect(Number(stored.credentials.expiresAt)).toBe(Date.now() + 3_600_000);
});

test("Device Flow increases the interval on slow_down", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  await sandbox({}, { clientId });
  mockSequence((address) => {
    if (address === `${base}/oauth/authorize_device`)
      return Response.json({
        device_code: "device-3",
        user_code: "QRST-UVWX",
        verification_uri: `${base}/-/device`,
        expires_in: 300,
        interval: 5,
      });
    if (address === `${base}/oauth/token`) return Response.json({ error: "slow_down" });
    return Response.json({}, { status: 404 });
  });
  const { beginGitlabLogin, pollGitlabLogin } = await import("../modules/gitlab/index.ts");
  const login = await beginGitlabLogin();
  advance(5.1);
  expect(await pollGitlabLogin({ id: login.id })).toStrictEqual({ pending: true, interval: 10 });
});

test("Device Flow reports expired codes and denied access", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  await sandbox({}, { clientId });
  let error = "expired_token";
  mockSequence((address) => {
    if (address === `${base}/oauth/authorize_device`)
      return Response.json({
        device_code: "device-4",
        user_code: "YZAB-CDEF",
        verification_uri: `${base}/-/device`,
        expires_in: 300,
        interval: 5,
      });
    if (address === `${base}/oauth/token`) return Response.json({ error });
    return Response.json({}, { status: 404 });
  });
  const { beginGitlabLogin, pollGitlabLogin } = await import("../modules/gitlab/index.ts");
  let login = await beginGitlabLogin();
  advance(5.1);
  await expect(pollGitlabLogin({ id: login.id })).rejects.toMatchObject({
    status: 400,
    message: /Код входа истёк/,
  });

  login = await beginGitlabLogin();
  advance(5.1);
  error = "access_denied";
  await expect(pollGitlabLogin({ id: login.id })).rejects.toMatchObject({
    status: 400,
    message: /Вход отменён в GitLab/,
  });

  // A session that outlived the advertised lifetime is rejected before another request.
  login = await beginGitlabLogin();
  advance(301);
  await expect(pollGitlabLogin({ id: login.id })).rejects.toMatchObject({
    status: 400,
    message: /Код входа истёк/,
  });
});

test("an expiring OAuth token refreshes once for parallel requests and preserves the login", async () => {
  await sandbox(oauthCredentials({ expiresAt: String(Date.now() + 30_000) }), { clientId });
  let refreshes = 0;
  mockSequence((address, init) => {
    expect(address).toBe(`${base}/oauth/token`);
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = form(init);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-1");
    expect(body.get("client_id")).toBe(clientId);
    refreshes++;
    return Response.json({
      access_token: refreshed,
      refresh_token: "refresh-3",
      expires_in: 7200,
      token_type: "Bearer",
    });
  });
  const { gitlabTarget } = await import("../modules/gitlab/index.ts");
  const [first, second] = await Promise.all([
    gitlabTarget("git.example.com/team/app"),
    gitlabTarget("git.example.com/team/app"),
  ]);
  expect(refreshes).toBe(1);
  expect(first).toMatchObject({ token: refreshed, tokenType: "oauth" });
  expect(second).toMatchObject({ token: refreshed, tokenType: "oauth" });

  const { integrationConfig } = await import("../modules/integration-store/index.ts");
  const stored = await integrationConfig("gitlab");
  expect(stored.credentials).toMatchObject({
    kind: "oauth",
    token: refreshed,
    refreshToken: "refresh-3",
    login: "tanuki",
  });
  expect(Number(stored.credentials.expiresAt)).toBeGreaterThan(Date.now() + 7_000_000);
});

test("an OAuth 401 refreshes and retries once, while a PAT 401 is returned once", async () => {
  await sandbox(oauthCredentials(), { clientId });
  let apiCalls = 0;
  let refreshes = 0;
  mockSequence((address, init) => {
    if (address === `${base}/api/v4/user`) {
      apiCalls++;
      expect(init.headers["PRIVATE-TOKEN"]).toBe(undefined);
      expect(init.headers.Authorization).toBe(`Bearer ${apiCalls === 1 ? access : refreshed}`);
      if (apiCalls === 1) return Response.json({}, { status: 401 });
      return Response.json({ username: "tanuki" });
    }
    if (address === `${base}/oauth/token`) {
      refreshes++;
      expect(form(init).get("grant_type")).toBe("refresh_token");
      return Response.json({
        access_token: refreshed,
        refresh_token: "refresh-4",
        expires_in: 7200,
      });
    }
    return Response.json({}, { status: 404 });
  });
  const { gitlabReader } = await import("../modules/gitlab/index.ts");
  const reader = await gitlabReader("git.example.com/team/app");
  expect(await reader.get("/user")).toStrictEqual({ username: "tanuki" });
  expect(reader.target.token).toBe(refreshed);
  expect(apiCalls).toBe(2);
  expect(refreshes).toBe(1);
});

test("a PAT 401 is not refreshed and is returned once", async () => {
  await sandbox({ token: pat, login: "tester" });
  let apiCalls = 0;
  let refreshCalls = 0;
  mockSequence((address) => {
    if (address === `${base}/oauth/token`) refreshCalls++;
    apiCalls++;
    return Response.json({}, { status: 401 });
  });
  const { gitlabReader } = await import("../modules/gitlab/index.ts");
  const reader = await gitlabReader("git.example.com/team/app");
  await expect(reader.get("/user")).rejects.toMatchObject({ status: 401 });
  expect(apiCalls).toBe(1);
  expect(refreshCalls).toBe(0);
});

test("OAuth sends only Bearer and never leaks a self-hosted token to gitlab.com", async () => {
  await sandbox(oauthCredentials(), { clientId });
  const seen = [];
  mockSequence((address, init) => {
    seen.push({ address, headers: init.headers });
    const path = new URL(address).pathname;
    if (address.endsWith("/api/v4/user")) return Response.json({ username: "tanuki" });
    if (path === "/api/v4/projects/group%2Fproject")
      return Response.json({ path_with_namespace: "group/project", default_branch: "main" });
    if (path.endsWith("/languages")) return Response.json({});
    if (path.includes("/repository/commits/main")) return Response.json({ id: "a".repeat(40) });
    return Response.json({}, { status: 404 });
  });
  const { gitlab, browseGitlabRepository, gitlabTarget } =
    await import("../modules/gitlab/index.ts");
  await gitlab(base, "/user", access, { tokenType: "oauth" });
  await gitlab(base, "/user", pat);
  expect(seen[0].headers.Authorization).toBe(`Bearer ${access}`);
  expect(seen[0].headers["PRIVATE-TOKEN"]).toBe(undefined);
  expect(seen[1].headers["PRIVATE-TOKEN"]).toBe(pat);
  expect(seen[1].headers.Authorization).toBe(undefined);

  const anonymous = await gitlabTarget("gitlab.com/group/project");
  expect(anonymous.token).toBe("");
  expect(anonymous.tokenType).toBe(undefined);
  await browseGitlabRepository("gitlab.com/group/project");
  const remote = seen.find((call) => call.address.startsWith("https://gitlab.com/api/v4/"));
  expect(remote).toBeDefined();
  expect(remote.headers.Authorization).toBe(undefined);
  expect(remote.headers["PRIVATE-TOKEN"]).toBe(undefined);
});
