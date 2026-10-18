import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { providersPath } from "../core/modules/app-paths/index.ts";
import {
  DEFAULT_PROVIDERS_SECRET,
  obfuscateSecret,
} from "../server/modules/providers/secret-obfuscation.ts";
import { createVault } from "../server/modules/secrets/index.ts";
import {
  loadPublicProviders,
  resolveOpenAIProvider,
  useProviderVault,
} from "../server/modules/providers/index.ts";
import { expect, test } from "vite-plus/test";
import {
  completeCommandRequest,
  createSecretBridge,
} from "../server/modules/agent/command-bridge.ts";
import { createToolSpecs } from "../server/modules/agents/projector/tool-specs.ts";
import {
  resolveEnvTarget,
  writeEnvSecret,
} from "../server/modules/agents/projector/secrets/secret-destination.ts";

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
  expect((await stat(join(cwd, ".env"))).mode & 0o777).toBe(0o640);
});

test("a new .env is private and values that need it are quoted", async () => {
  const cwd = await project();
  const target = await resolveEnvTarget(cwd, "prod.env", "DB_PASSWORD");
  expect(target.replaces).toBe(false);
  await writeEnvSecret(target, "pa ss'word\nline");
  expect(await readFile(join(cwd, "prod.env"), "utf8")).toBe('DB_PASSWORD="pa ss\'word\\nline"\n');
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
  const controller = new AbortController();
  const ask = createSecretBridge((event, data) => events.push({ event, data }), controller.signal);
  const pending = ask({
    label: "Ключ OpenAI",
    destination: { kind: "env_file", file: ".env", key: "OPENAI_API_KEY", replaces: false },
  });
  const sent = events.at(-1);
  expect(sent.event).toBe("secret-request");
  expect(JSON.stringify(sent.data)).not.toContain("sk-");
  completeCommandRequest(sent.data.id, { output: { value: "sk-typed" } });
  await expect(pending).resolves.toBe("sk-typed");

  const declined = ask({
    label: "Ключ",
    destination: { kind: "env_file", file: ".env", key: "K", replaces: false },
  });
  completeCommandRequest(events.at(-1).data.id, { output: {} });
  await expect(declined).resolves.toBeNull();
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
});

test("the secret tool is absent when the client cannot show the prompt", () => {
  const names = createToolSpecs({ onProject: () => {} }).map((item) => item.name);
  expect(names).not.toContain("request_secret");
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
