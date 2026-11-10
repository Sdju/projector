import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { providersPath } from "../../core/modules/app-paths/index.ts";
import {
  DEFAULT_PROVIDERS_SECRET,
  obfuscateSecret,
} from "../modules/providers/secret-obfuscation.ts";
import { createVault } from "../modules/secrets/index.ts";
import {
  loadPublicProviders,
  resolveOpenAIProvider,
  useProviderVault,
} from "../modules/providers/index.ts";
import { expect, test } from "vite-plus/test";
import { completeCommandRequest, createSecretBridge } from "../modules/agent/command-bridge.ts";
import { createToolSpecs } from "../modules/agents/projector/tool-specs.ts";
import {
  resolveEnvTarget,
  writeEnvSecret,
} from "../modules/agents/projector/secrets/secret-destination.ts";
import { runSecretScript } from "../modules/agent/secret-show.ts";

async function project() {
  const root = await mkdtemp(join(tmpdir(), "projector-secret-"));
  return root;
}

test("a secret is written to the chosen .env, other lines and the file mode are kept", async () => {
  const cwd = await project();
  await writeFile(join(cwd, ".env"), "# keep\nOTHER=1\nOPENAI_API_KEY=old\n", { mode: 0o640 });
  const target = await resolveEnvTarget(cwd, ".env", "OPENAI_API_KEY");
  expect(target).toMatchObject({ file: ".env", replaces: true });
  await writeEnvSecret(target, "sk-live-123");
  expect(await readFile(join(cwd, ".env"), "utf8")).toBe(
    "# keep\nOTHER=1\nOPENAI_API_KEY=sk-live-123\n",
  );
  // Windows does not expose POSIX permission bits; the content check above is the real assertion.
  if (process.platform !== "win32")
    expect((await stat(join(cwd, ".env"))).mode & 0o777).toBe(0o640);
});

test("a new .env is private and values that need it are quoted", async () => {
  const cwd = await project();
  const target = await resolveEnvTarget(cwd, "prod.env", "DB_PASSWORD");
  expect(target.replaces).toBe(false);
  await writeEnvSecret(target, "pa ss'word\nline");
  expect(await readFile(join(cwd, "prod.env"), "utf8")).toBe('DB_PASSWORD="pa ss\'word\\nline"\n');
  if (process.platform !== "win32")
    expect((await stat(join(cwd, "prod.env"))).mode & 0o777).toBe(0o600);
});

test("the destination must be a .env file of the project, reached without links out of it", async () => {
  const cwd = await project();
  const outside = await project();
  await expect(resolveEnvTarget(cwd, "config.json", "KEY")).rejects.toThrow(/\.env/);
  await expect(resolveEnvTarget(cwd, "../escape.env", "KEY")).rejects.toThrow(/внутри проекта/);
  await expect(resolveEnvTarget(cwd, ".env", "1BAD")).rejects.toThrow(/Имя переменной/);
  await expect(resolveEnvTarget(undefined, ".env", "KEY")).rejects.toThrow(/проект/);
  await symlink(join(outside, ".env"), join(cwd, ".env"));
  await expect(resolveEnvTarget(cwd, ".env", "KEY")).rejects.toThrow();
});

test("the bridge hands the typed value only to the caller and reports a decline as null", async () => {
  const events = [];
  const destination = {
    kind: "env_file",
    file: ".env",
    key: "OPENAI_API_KEY",
    replaces: false,
  };
  const controller = new AbortController();
  const ask = createSecretBridge((event, data) => events.push({ event, data }), controller.signal);
  const pending = ask({ label: "Ключ OpenAI", destination });
  const sent = events.at(-1);
  expect(sent.event).toBe("secret-request");
  expect(sent.data).toMatchObject({ label: "Ключ OpenAI", destination });
  expect(completeCommandRequest(sent.data.id, { output: { value: "sk-typed" } })).toBe(true);
  await expect(pending).resolves.toBe("sk-typed");
  // The caller receives the value; nothing sent to the browser does, before or after typing.
  expect(JSON.stringify(events)).not.toContain("sk-typed");

  const declined = ask({ label: "Ключ", destination });
  completeCommandRequest(events.at(-1).data.id, { output: {} });
  await expect(declined).resolves.toBeNull();

  const blank = ask({ label: "Ключ", destination });
  completeCommandRequest(events.at(-1).data.id, { output: { value: "" } });
  await expect(blank).resolves.toBeNull();

  // Abort and timeout reject, so a missing secret is never mistaken for a typed one.
  const stopping = new AbortController();
  const stoppingAsk = createSecretBridge(
    (event, data) => events.push({ event, data }),
    stopping.signal,
  );
  const aborted = stoppingAsk({ label: "Ключ", destination });
  stopping.abort();
  await expect(aborted).rejects.toThrow(/остановлен/);

  const slow = createSecretBridge(
    (event, data) => events.push({ event, data }),
    new AbortController().signal,
    5,
  );
  await expect(slow({ label: "Ключ", destination })).rejects.toThrow(/не получен вовремя/);

  expect(JSON.stringify(events)).not.toContain("sk-typed");
});

test("request_secret returns only the fact of storing, never the value", async () => {
  const cwd = await project();
  const spec = createToolSpecs({
    cwd,
    onProject: () => {},
    secret: async () => "sk-very-secret-value",
  }).find((item) => item.name === "request_secret");
  const result = await spec.run({ kind: "env", label: "Ключ", key: "OPENAI_API_KEY" });
  expect(result).toMatchObject({ stored: true, file: ".env", key: "OPENAI_API_KEY" });
  expect(JSON.stringify(result)).not.toContain("sk-very-secret-value");
  expect(await readFile(join(cwd, ".env"), "utf8")).toBe("OPENAI_API_KEY=sk-very-secret-value\n");

  const declined = createToolSpecs({ cwd, onProject: () => {}, secret: async () => null }).find(
    (item) => item.name === "request_secret",
  );
  expect(await declined.run({ kind: "env", label: "Ключ", key: "OPENAI_API_KEY" })).toEqual({
    stored: false,
    declined: true,
  });

  // Without a client that can show the prompt, the tool is not constructed at all.
  expect(createToolSpecs({ onProject: () => {} }).map((item) => item.name)).not.toContain(
    "request_secret",
  );
});

test("show_secret returns only the fact of delivery, never the script's value", async () => {
  const cwd = await project();
  const asked = [];
  const spec = createToolSpecs({
    cwd,
    onProject: () => {},
    showSecret: async (request) => {
      asked.push(request);
      return { shown: true, delivered: true, label: request.label };
    },
  }).find((item) => item.name === "show_secret");
  const result = await spec.run({
    script: "printf 'sk-shown-value'",
    label: "Ключ SSH",
    comment: "Скопируйте его в сервис.",
  });
  expect(result).toEqual({ shown: true, delivered: true, label: "Ключ SSH" });
  expect(asked[0]).toEqual({
    script: "printf 'sk-shown-value'",
    label: "Ключ SSH",
    comment: "Скопируйте его в сервис.",
  });
  expect(JSON.stringify(result)).not.toContain("sk-shown-value");

  // Without a page that can show the panel the tool is not offered at all.
  expect(createToolSpecs({ onProject: () => {} }).map((item) => item.name)).not.toContain(
    "show_secret",
  );
});

test("runSecretScript returns stdout and never puts stderr into the error", async () => {
  if (process.platform === "win32") return;
  const cwd = await project();
  await expect(runSecretScript("printf 'sk-from-script\\n'", { cwd })).resolves.toBe(
    "sk-from-script",
  );
  await expect(runSecretScript("printf '  \\n'", { cwd })).rejects.toThrow(/ничего не вернул/);
  let failure = "";
  try {
    await runSecretScript("printf 'sk-leaked-to-stderr' >&2; exit 2", { cwd });
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  expect(failure).toMatch(/завершился/);
  expect(failure).not.toContain("sk-leaked-to-stderr");
});

test("gitIgnored says whether the project's rules keep the written .env out of commits", async () => {
  const cwd = await project();
  execFileSync("git", ["init", "-q", cwd]);
  const store = createToolSpecs({
    cwd,
    onProject: () => {},
    secret: async () => "sk-ignored",
  }).find((item) => item.name === "request_secret");
  const storeIn = async () => (await store.run({ kind: "env", key: "TOKEN" })).gitIgnored;

  // Nothing ignores the new file yet: it would be committed.
  expect(await storeIn()).toBe(false);
  await writeFile(join(cwd, ".gitignore"), ".env\n");
  expect(await storeIn()).toBe(true);
  // A tracked file is no longer ignored even when a rule matches it.
  execFileSync("git", ["-C", cwd, "add", "-f", ".env"]);
  expect(await storeIn()).toBe(false);

  // Outside a repository the answer is unknown, not a promise that the secret stays out.
  const plain = await project();
  const outside = createToolSpecs({
    cwd: plain,
    onProject: () => {},
    secret: async () => "sk-plain",
  }).find((item) => item.name === "request_secret");
  expect((await outside.run({ kind: "env", key: "TOKEN" })).gitIgnored).toBeUndefined();
});

function fakeKeyring({ available = true } = {}) {
  const items = new Map();
  return {
    items,
    available: async () => available,
    get: async (key) => items.get(key.account),
    set: async (key, _label, value) => void items.set(key.account, value),
    delete: async (key) => void items.delete(key.account),
  };
}

const tool = (secret, name) =>
  createToolSpecs({ onProject: () => {}, secret }).find((item) => item.name === name);

test("a provider key goes to the keyring and never into providers.json", async () => {
  const keyring = fakeKeyring();
  useProviderVault(createVault(keyring, () => undefined));
  const asked = [];
  const result = await tool(
    async (request) => (asked.push(request), "sk-provider-123"),
    "request_secret",
  ).run({
    kind: "ai_provider",
    name: "Acme AI",
    url: "https://api.acme.test/v1",
    model: "acme-1",
  });
  expect(result).toMatchObject({ stored: true, name: "Acme AI", replaced: false });
  expect(asked[0].destination).toMatchObject({
    kind: "ai_provider",
    url: "https://api.acme.test/v1",
    model: "acme-1",
  });
  expect(JSON.stringify(asked[0])).not.toContain("sk-provider-123");
  expect(JSON.stringify(result)).not.toContain("sk-provider-123");
  expect([...keyring.items.values()]).toContain("sk-provider-123");
  expect(await readFile(providersPath(), "utf8")).not.toContain("sk-provider-123");

  const listed = await tool(undefined, "list_secret_destinations").run({});
  const acme = listed.providers.find((item) => item.name === "Acme AI");
  expect(acme).toMatchObject({ hasApiKey: true, url: "https://api.acme.test/v1" });
  expect(JSON.stringify(listed)).not.toContain("sk-provider-123");
});

test("without a keyring a provider key is refused before the user is asked", async () => {
  useProviderVault(createVault(fakeKeyring({ available: false }), () => undefined));
  let asked = false;
  await expect(
    tool(async () => ((asked = true), "x"), "request_secret").run({
      kind: "ai_provider",
      name: "Offline AI",
      url: "https://offline.test/v1",
    }),
  ).rejects.toThrow(/системном хранилище/);
  expect(asked).toBe(false);
});

test("a provider needs a name and an http(s) address", async () => {
  useProviderVault(createVault(fakeKeyring(), () => undefined));
  const run = (input) =>
    tool(async () => "x", "request_secret").run({ kind: "ai_provider", ...input });
  await expect(run({ url: "https://a.test/v1" })).rejects.toThrow(/название/);
  await expect(run({ name: "Bad", url: "ftp://a.test" })).rejects.toThrow(/http/);
  await expect(run({ providerId: "missing-id" })).rejects.toThrow(/не найден/);
});

test("a legacy obfuscated key moves to the keyring on first view", async () => {
  const keyring = fakeKeyring();
  useProviderVault(createVault(keyring, () => undefined));
  const legacy = obfuscateSecret("sk-legacy-456", DEFAULT_PROVIDERS_SECRET);
  await mkdir(dirname(providersPath()), { recursive: true });
  await writeFile(
    providersPath(),
    JSON.stringify({
      activeProviderId: "legacy",
      providers: [
        { id: "legacy", name: "Old", url: "https://old.test/v1", model: "m", apiKey: legacy },
      ],
    }),
  );
  const state = await loadPublicProviders({});
  expect(state.providers.find((item) => item.id === "legacy")).toMatchObject({ hasApiKey: true });
  expect(await readFile(providersPath(), "utf8")).not.toContain("enc:v1:");
  expect(keyring.items.get("provider:legacy")).toBe("sk-legacy-456");
  const resolved = await resolveOpenAIProvider({ providerId: "legacy", fallback: {} });
  expect(resolved.apiKey).toBe("sk-legacy-456");
});

test("a damaged providers file is kept aside, not overwritten by the defaults", async () => {
  useProviderVault(createVault(fakeKeyring(), () => undefined));
  await mkdir(dirname(providersPath()), { recursive: true });
  await writeFile(providersPath(), '{"providers": [{"id": "mine"');
  const state = await loadPublicProviders({});
  expect(state.providers.length).toBeGreaterThan(0);
  const names = await readdir(dirname(providersPath()));
  const broken = names.find((name) => name.startsWith("providers.json.broken-"));
  expect(broken).toBeDefined();
  expect(await readFile(join(dirname(providersPath()), broken), "utf8")).toContain('"mine"');
  expect(names.filter((name) => name.endsWith(".tmp"))).toEqual([]);
});

test("an unreadable providers file is an error, not a first run", async () => {
  await mkdir(dirname(providersPath()), { recursive: true });
  await rm(providersPath(), { force: true });
  await mkdir(providersPath());
  await expect(loadPublicProviders({})).rejects.toThrow();
  await rm(providersPath(), { recursive: true });
});

test("an integration must be enabled before its token is asked for", async () => {
  let asked = false;
  await expect(
    tool(async () => ((asked = true), "x"), "request_secret").run({
      kind: "integration",
      integration: "gitlab",
    }),
  ).rejects.toThrow(/Включите интеграцию GitLab/);
  expect(asked).toBe(false);
});
