import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { os } from "@ai-projector/core/modules/os/index.ts";
import type {
  GitBranch,
  GitBranches,
  GitSync,
  GitSyncAction,
} from "@ai-projector/core/modules/workspace/index.ts";
import { environmentForPath, runEnvironmentCommand } from "../environments/index.ts";
import { integrationConfig } from "../integration-store/index.ts";
import { gitlabAccessToken, gitlabBaseUrl } from "../gitlab/index.ts";
import { HttpError } from "../http/index.ts";
import { git, serializeGitWrite } from "./git.ts";
import { projectBranches } from "./git-branches.ts";

/** Network operations wait for the remote, not just for the local command. */
const TIMEOUT = 120_000;

interface GitAuth {
  username: string;
  tokenEnv: string;
  token: string;
}

function httpsHost(remote: string): string | null {
  try {
    const url = new URL(remote);
    return url.protocol === "https:" ? url.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Credentials of a matching integration; a self-hosted GitLab token never follows a gitlab.com link. */
async function credentialsFor(
  root: string,
  remote: string,
  push: boolean,
): Promise<GitAuth | undefined> {
  const url = (
    await git(root, ["remote", "get-url", ...(push ? ["--push"] : []), remote]).catch(() => "")
  ).trim();
  const host = httpsHost(url);
  if (!host) return undefined;
  if (host === "github.com") {
    const config = await integrationConfig("github");
    const token = config.enabled ? config.credentials.token || "" : "";
    return token
      ? { username: "x-access-token", tokenEnv: "PROJECTOR_GITHUB_TOKEN", token }
      : undefined;
  }
  const config = await integrationConfig("gitlab");
  if (!config.enabled || !config.credentials.token) return undefined;
  let base: string;
  let configured: string;
  try {
    base = gitlabBaseUrl(config.settings.url);
    configured = new URL(base).hostname.toLowerCase();
  } catch {
    base = "https://gitlab.com";
    configured = "gitlab.com";
  }
  if (host !== configured) return undefined;
  // A gitlab.com alias must not receive a token meant for a private instance.
  if (host === "gitlab.com" && configured !== "gitlab.com") return undefined;
  const token = await gitlabAccessToken(base, config.credentials).catch(
    () => config.credentials.token || "",
  );
  return token ? { username: "oauth2", tokenEnv: "PROJECTOR_GITLAB_TOKEN", token } : undefined;
}

function assertToken(token: string) {
  if (token.includes("\n") || token.includes("\r"))
    throw new HttpError(409, "Некорректный токен интеграции");
}

function quote(shellWord: string) {
  return `'${shellWord.replaceAll("'", "'\\''")}'`;
}

const containerScript = (
  auth: GitAuth,
) => String.raw`cat > /tmp/projector-askpass <<'PROJECTOR_ASKPASS'
#!/bin/sh
case "$1" in
  *Username*) printf "%s\n" ${quote(auth.username)} ;;
  *) printf "%s\n" "$${auth.tokenEnv}" ;;
esac
PROJECTOR_ASKPASS
chmod 700 /tmp/projector-askpass
export GIT_ASKPASS=/tmp/projector-askpass GIT_TERMINAL_PROMPT=0
exec /usr/bin/git --literal-pathspecs -c credential.helper= -c http.followRedirects=false -C /workspace "$@"`;

async function runInEnvironment(
  environment: NonNullable<Awaited<ReturnType<typeof environmentForPath>>>,
  args: string[],
  auth: GitAuth | undefined,
) {
  const helper = await mkdtemp(join(tmpdir(), "projector-git-"));
  const credentials = auth ? join(helper, "credentials") : undefined;
  try {
    if (auth && credentials) {
      assertToken(auth.token);
      await writeFile(credentials, `${auth.tokenEnv}=${auth.token}\n`, { mode: 0o600 });
      await os.tools.restrictToOwner(credentials);
    }
    const command = auth
      ? [
          "/bin/bash",
          "--noprofile",
          "--norc",
          "-c",
          containerScript(auth),
          "projector-git",
          ...args,
        ]
      : ["/usr/bin/git", "--literal-pathspecs", "-C", "/workspace", ...args];
    return (await runEnvironmentCommand(environment, command, TIMEOUT, undefined, credentials))
      .stdout;
  } finally {
    await rm(helper, { recursive: true, force: true });
  }
}

/** Runs a network command with the matching integration token; the token stays out of argv and errors. */
async function runRemote(root: string, args: string[], remote: string, push = false) {
  const auth = await credentialsFor(root, remote, push);
  const environment = await environmentForPath(root);
  if (environment) return runInEnvironment(environment, args, auth);
  if (!auth) return git(root, args, { timeout: TIMEOUT, env: { GIT_TERMINAL_PROMPT: "0" } });
  assertToken(auth.token);
  const helper = await mkdtemp(join(tmpdir(), "projector-git-"));
  try {
    const script = os.tools.gitAskpass(auth);
    const askpass = join(helper, script.filename);
    await writeFile(askpass, script.contents, { mode: 0o700 });
    return await git(
      root,
      ["-c", "credential.helper=", "-c", "http.followRedirects=false", ...args],
      {
        timeout: TIMEOUT,
        env: {
          GIT_ASKPASS: askpass,
          GIT_TERMINAL_PROMPT: "0",
          [auth.tokenEnv]: auth.token,
        },
      },
    );
  } finally {
    await rm(helper, { recursive: true, force: true });
  }
}

function redact(text: string) {
  return text
    .replace(/(https?:\/\/)[^\s/@]+@/gi, "$1***@")
    .replace(/([?&](?:token|access_token|private_token)=)[^\s&]+/gi, "$1***");
}

async function run(root: string, args: string[], remote: string, push = false) {
  try {
    return await runRemote(root, args, remote, push);
  } catch (error) {
    const raw = String(
      (error as { stderr?: unknown })?.stderr ?? (error instanceof Error ? error.message : error),
    );
    const lines = redact(raw)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 6)
      .join("\n");
    throw new HttpError(409, lines || "Операция Git не выполнена");
  }
}

async function currentBranch(root: string) {
  const branches = await projectBranches(root);
  if (!branches.available) throw new HttpError(404, "Здесь нет Git-репозитория");
  const current = branches.branches.find((branch) => branch.current);
  if (!current || branches.detached)
    throw new HttpError(409, "Сначала переключитесь на ветку, а не на отдельный коммит");
  return { branches, current };
}

/** The configured remote of a branch; push may use a separate pushRemote or remote.pushDefault. */
async function remoteOf(
  root: string,
  branches: GitBranches,
  branch: GitBranch,
  action: GitSyncAction,
) {
  const config = (key: string) =>
    git(root, ["config", "--get", key])
      .then((value) => value.trim())
      .catch(() => "");
  const fallback = branches.remotes.includes("origin") ? "origin" : branches.remotes[0];
  const remote =
    action === "push"
      ? (await config(`branch.${branch.name}.pushRemote`)) ||
        (await config("remote.pushDefault")) ||
        (await config(`branch.${branch.name}.remote`)) ||
        fallback
      : (await config(`branch.${branch.name}.remote`)) || fallback;
  if (!remote || !branches.remotes.includes(remote))
    throw new HttpError(409, "У репозитория нет удалённого репозитория для этой ветки");
  return remote;
}

// One network operation per repository; the index queue stays separate for quick local work.
const pendingNetwork = new Map<string, Promise<unknown>>();

async function serializeNetwork<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const key = (await git(root, ["rev-parse", "--absolute-git-dir"]).catch(() => root)).trim();
  const previous = pendingNetwork.get(key);
  const current = (async () => {
    await previous?.catch(() => {});
    return operation();
  })();
  pendingNetwork.set(key, current);
  try {
    return await current;
  } finally {
    if (pendingNetwork.get(key) === current) pendingNetwork.delete(key);
  }
}

export async function mutateProjectSync(root: string, action: string): Promise<GitSync> {
  if (!["fetch", "pull", "push"].includes(action))
    throw new HttpError(400, "Неизвестное действие синхронизации");
  const operation = action as GitSyncAction;
  const { branches, current } = await currentBranch(root);
  const remote = await remoteOf(root, branches, current, operation);
  if (operation === "pull") {
    if (!current.upstream || current.gone)
      throw new HttpError(409, "У ветки нет upstream. Отправьте ветку, чтобы создать его");
    return serializeNetwork(root, () =>
      serializeGitWrite(root, async () => {
        const output = await run(root, ["pull", "--ff-only"], remote);
        const fresh = await projectBranches(root);
        const upToDate = /already up[ -]to[ -]date|уже актуально/i.test(output);
        return {
          action: operation,
          branches: fresh,
          message: upToDate ? "Уже актуально" : "Изменения получены",
        };
      }),
    );
  }
  if (operation === "fetch") {
    return serializeNetwork(root, async () => {
      await run(root, ["fetch", "--prune", remote], remote);
      return {
        action: operation,
        branches: await projectBranches(root),
        message: "Удалённые ветки обновлены",
      };
    });
  }
  return serializeNetwork(root, async () => {
    // A missing or deleted upstream is published again, like «Publish branch» in an editor.
    const publish = !current.upstream || current.gone;
    const ahead = current.ahead;
    const merge = publish
      ? ""
      : (
          await git(root, ["config", "--get", `branch.${current.name}.merge`]).catch(() => "")
        ).trim();
    const target = merge.startsWith("refs/heads/")
      ? merge.slice("refs/heads/".length)
      : current.name;
    const args = publish
      ? ["push", "--set-upstream", remote, current.name]
      : ["push", remote, `${current.name}:${target}`];
    await run(root, args, remote, true);
    const fresh = await projectBranches(root);
    return {
      action: operation,
      branches: fresh,
      message: publish
        ? `Ветка ${current.name} опубликована`
        : ahead > 0
          ? `Отправлено коммитов: ${ahead}`
          : "Нечего отправлять",
    };
  });
}
