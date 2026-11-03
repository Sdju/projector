import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { SecretDestination } from "../../../agent/index.ts";
import {
  assertKeyStore,
  envFallbackFromProcess,
  loadPublicProviders,
  saveProviders,
} from "../../../providers/index.ts";
import type { OpenAIProviderWrite } from "../../../providers/index.ts";
import { integrationConfig } from "../../../integration-store/index.ts";
import { connectGithub } from "../../../github/index.ts";
import { connectGitlab } from "../../../gitlab/index.ts";
import { storeSearchKey } from "../projector-web-search.ts";

/** Where the user's secret is written; the agent names it, never sees what ends up there. */
export interface EnvFileTarget {
  kind: "env_file";
  /** Absolute path inside the project. */
  path: string;
  /** Path as the user sees it, relative to the project. */
  file: string;
  key: string;
  /** The key is already in the file, so the answer replaces its value. */
  replaces: boolean;
}

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ENV_FILE = /^\.env(\..+)?$|\.env$/;
const MAX_VALUE = 16 * 1024;

const lineOf = (key: string) => new RegExp(`^\\s*(export\\s+)?${key}\\s*=`);

async function inside(root: string, target: string): Promise<boolean> {
  const path = relative(await realpath(root), target);
  return !!path && !path.startsWith("..") && !isAbsolute(path);
}

/**
 * Checks an agent-chosen destination before the user is asked for anything: only `.env` files
 * of the project itself, never through a link out of it, with an environment-variable name.
 */
export async function resolveEnvTarget(
  cwd: string | undefined,
  file: string,
  key: string,
): Promise<EnvFileTarget> {
  if (!cwd) throw new Error("Откройте чат агента в проекте, чтобы записать секрет в его .env");
  if (!KEY.test(key)) throw new Error("Имя переменной: латиница, цифры и _, без цифры в начале");
  if (!ENV_FILE.test(basename(file)))
    throw new Error("Секрет можно записать только в файл .env (.env.local, prod.env и т. п.)");
  const path = resolve(cwd, file);
  if (!(await inside(cwd, join(await realpath(dirname(path)).catch(() => path), basename(path)))))
    throw new Error("Файл должен лежать внутри проекта");
  const existing = await lstat(path).catch(() => undefined);
  if (existing && !existing.isFile()) throw new Error("Файл .env должен быть обычным файлом");
  const text = existing ? await readFile(path, "utf8") : "";
  return {
    kind: "env_file",
    path,
    file: relative(cwd, path),
    key,
    replaces: text.split("\n").some((line) => lineOf(key).test(line)),
  };
}

/** A value as one `.env` line accepts it: bare when plain, otherwise quoted. */
function format(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  if (!/['\n\r]/.test(value)) return `'${value}'`;
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
  return `"${escaped}"`;
}

/** Writes or replaces `KEY=value`, keeping the other lines; a new file is private to the user. */
export async function writeEnvSecret(target: EnvFileTarget, value: string): Promise<void> {
  if (!value || value.includes("\0") || value.length > MAX_VALUE)
    throw new Error("Недопустимое значение секрета");
  const existing = await lstat(target.path).catch(() => undefined);
  if (existing && !existing.isFile()) throw new Error("Файл .env должен быть обычным файлом");
  const text = existing ? await readFile(target.path, "utf8") : "";
  const line = `${target.key}=${format(value)}`;
  const lines = text ? text.split("\n") : [];
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const at = lines.findIndex((item) => lineOf(target.key).test(item));
  if (at >= 0) lines[at] = line;
  else lines.push(line);
  const tmp = `${target.path}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${lines.join("\n")}\n`, { mode: existing ? existing.mode & 0o777 : 0o600 });
  await rename(tmp, target.path);
}

/** Whether git ignores the file (the secret would not be committed); `undefined` outside a repository. */
export function gitIgnores(cwd: string, path: string): Promise<boolean | undefined> {
  return new Promise((done) => {
    execFile("git", ["check-ignore", "-q", "--", path], { cwd }, (error) => {
      if (!error) return done(true);
      done((error as { code?: unknown }).code === 1 ? false : undefined);
    });
  });
}

/** An AI provider whose key goes to the keyring; `replaces` when a key is already there. */
export interface ProviderTarget {
  kind: "ai_provider";
  id: string;
  name: string;
  url: string;
  model: string;
  replaces: boolean;
}

/** A service account token, stored by the integration's own connect step (it checks the token). */
export interface IntegrationTarget {
  kind: "integration";
  integration: "github" | "gitlab" | "web_search";
  label: string;
  replaces: boolean;
}

export type SecretTarget = EnvFileTarget | ProviderTarget | IntegrationTarget;

/** The part of a target the user may see; the project path stays on the server. */
export function destinationOf(target: SecretTarget): SecretDestination {
  if (target.kind === "env_file")
    return { kind: "env_file", file: target.file, key: target.key, replaces: target.replaces };
  if (target.kind === "ai_provider")
    return {
      kind: "ai_provider",
      id: target.id,
      name: target.name,
      url: target.url,
      model: target.model,
      replaces: target.replaces,
    };
  return {
    kind: "integration",
    integration: target.integration,
    label: target.label,
    replaces: target.replaces,
  };
}

export interface ProviderRequest {
  /** An existing provider: only its key changes. */
  providerId?: string;
  /** A new provider: its settings; the key is typed by the user. */
  name?: string;
  url?: string;
  model?: string;
}

const PROVIDER_ID_BASE = /[^a-z0-9]+/g;

/** A new provider gets a readable, unique ID made from its name. */
function newProviderId(name: string): string {
  const base = name.toLowerCase().replace(PROVIDER_ID_BASE, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${base || "provider"}-${randomUUID().slice(0, 8)}`;
}

/**
 * Checks the provider before the user is asked for anything: the keyring must be reachable, an
 * existing provider must exist, a new one needs a name and an http(s) address.
 */
export async function resolveProviderTarget(input: ProviderRequest): Promise<ProviderTarget> {
  await assertKeyStore();
  const state = await loadPublicProviders(envFallbackFromProcess());
  if (input.providerId) {
    const found = state.providers.find((item) => item.id === input.providerId);
    if (!found)
      throw new Error(`Провайдер ${input.providerId} не найден: список в list_secret_destinations`);
    const { id, name, url, models, hasApiKey } = found;
    return { kind: "ai_provider", id, name, url, model: models[0]?.id ?? "", replaces: hasApiKey };
  }
  const name = input.name?.trim() ?? "";
  if (!name) throw new Error("Укажите название нового провайдера");
  const url = input.url?.trim() ?? "";
  let protocol = "";
  try {
    protocol = new URL(url).protocol;
  } catch {
    protocol = "";
  }
  if (protocol !== "http:" && protocol !== "https:")
    throw new Error("Адрес провайдера должен начинаться с http:// или https://");
  return {
    kind: "ai_provider",
    id: newProviderId(name),
    name: name.slice(0, 80),
    url,
    model: input.model?.trim().slice(0, 200) ?? "",
    replaces: false,
  };
}

/** Saves the key with the provider's settings; other providers keep their stored keys. */
export async function storeProviderKey(target: ProviderTarget, value: string): Promise<void> {
  const fallback = envFallbackFromProcess();
  const state = await loadPublicProviders(fallback);
  const providers: OpenAIProviderWrite[] = state.providers.map(
    ({ id, name, kind, url, enabled, models }) => ({ id, name, kind, url, enabled, models }),
  );
  const at = providers.findIndex((item) => item.id === target.id);
  if (at >= 0) providers[at] = { ...providers[at], apiKey: value };
  else
    providers.push({
      id: target.id,
      name: target.name,
      url: target.url,
      model: target.model,
      apiKey: value,
    });
  await saveProviders({ activeProviderId: state.activeProviderId, providers }, fallback);
}

/** Only the integrations that accept a token from the user. */
const TOKEN_INTEGRATIONS = {
  github: "GitHub",
  gitlab: "GitLab",
  web_search: "веб-поиска",
} as const;
const SECRET_INTEGRATION_ID = {
  github: "github",
  gitlab: "gitlab",
  web_search: "web-search",
} as const;

/** The integration must be enabled; a token already connected is reported as `replaces`. */
export async function resolveIntegrationTarget(
  integration: "github" | "gitlab" | "web_search",
): Promise<IntegrationTarget> {
  const label = TOKEN_INTEGRATIONS[integration];
  const config = await integrationConfig(SECRET_INTEGRATION_ID[integration]);
  // The search key can be the first thing set up, so that integration needs no switch.
  if (integration !== "web_search" && !config.enabled)
    throw new Error(`Включите интеграцию ${label} в настройках`);
  return {
    kind: "integration",
    integration,
    label,
    replaces: Boolean(config.credentials.token),
  };
}

/** The integration's connect step checks the token with the service before storing it. */
export async function storeIntegrationToken(
  target: IntegrationTarget,
  value: string,
): Promise<void> {
  if (target.integration === "github") await connectGithub({ token: value });
  else if (target.integration === "gitlab") await connectGitlab({ token: value });
  else await storeSearchKey(value);
}

/** One entry point for every destination; the value is checked here, once, for all of them. */
export async function storeSecret(target: SecretTarget, value: string): Promise<void> {
  if (!value || value.includes("\0") || value.length > MAX_VALUE)
    throw new Error("Недопустимое значение секрета");
  if (target.kind === "env_file") await writeEnvSecret(target, value);
  else if (target.kind === "ai_provider") await storeProviderKey(target, value.trim());
  else await storeIntegrationToken(target, value.trim());
}

/** Where secrets can go right now, without any secret value: providers and token integrations. */
export async function listSecretDestinations() {
  const state = await loadPublicProviders(envFallbackFromProcess());
  const integrations = await Promise.all(
    (Object.keys(TOKEN_INTEGRATIONS) as Array<keyof typeof TOKEN_INTEGRATIONS>).map(async (id) => {
      const config = await integrationConfig(SECRET_INTEGRATION_ID[id]);
      return {
        integration: id,
        label: TOKEN_INTEGRATIONS[id],
        enabled: config.enabled,
        connected: Boolean(config.credentials.token),
      };
    }),
  );
  return { activeProviderId: state.activeProviderId, providers: state.providers, integrations };
}
