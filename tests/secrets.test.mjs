import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { os } from "../core/modules/os/index.ts";
import { createVault } from "../server/modules/secrets/index.ts";
import {
  integrationConfig,
  migrateIntegrationSecrets,
  revealIntegrationCredential,
  updateIntegration,
  useIntegrationVault,
} from "../server/modules/integrations/store.ts";

function fakeBackend({ available = true } = {}) {
  const items = new Map();
  const calls = { get: 0, set: 0 };
  return {
    items,
    calls,
    available: async () => available,
    get: async (key) => (calls.get++, items.get(key.account)),
    set: async (key, _label, value) => (calls.set++, void items.set(key.account, value)),
    delete: async (key) => void items.delete(key.account),
  };
}
async function withData(run) {
  const root = await mkdtemp(join(tmpdir(), "projector-secrets-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = root;
  try {
    await run(join(root, "projector", "integrations.json"));
  } finally {
    useIntegrationVault(createVault(fakeBackend({ available: false })));
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
  }
}

await test("credentials are stored in the keyring and never in the file", () =>
  withData(async (file) => {
    const backend = fakeBackend();
    useIntegrationVault(createVault(backend, () => undefined));
    await updateIntegration("github", (config) => ({
      ...config,
      enabled: true,
      credentials: { token: "ghp_secret", login: "octocat" },
    }));
    const text = await readFile(file, "utf8");
    assert.ok(!text.includes("ghp_secret"));
    assert.equal(JSON.parse(text).integrations.github.vault, "keyring");
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await integrationConfig("github")).credentials.token, "ghp_secret");

    await updateIntegration("github", (config) => ({ ...config, credentials: {} }));
    assert.equal(backend.items.size, 0);
    assert.equal(JSON.parse(await readFile(file, "utf8")).integrations.github.vault, undefined);
  }));

await test("file fallback keeps working without a keyring or when disabled", () =>
  withData(async (file) => {
    for (const [backend, mode] of [
      [fakeBackend({ available: false }), undefined],
      [fakeBackend(), "file"],
    ]) {
      useIntegrationVault(createVault(backend, () => mode));
      await updateIntegration("github", (config) => ({ ...config, credentials: { token: "t" } }));
      assert.equal(
        JSON.parse(await readFile(file, "utf8")).integrations.github.credentials.token,
        "t",
      );
      assert.equal(backend.items.size, 0);
    }
  }));

await test("plaintext credentials migrate once the keyring is reachable", () =>
  withData(async (file) => {
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        integrations: { github: { enabled: true, settings: {}, credentials: { token: "old" } } },
      }),
    );
    const backend = fakeBackend();
    useIntegrationVault(createVault(backend, () => undefined));
    assert.deepEqual(await migrateIntegrationSecrets(), ["github"]);
    assert.ok(!(await readFile(file, "utf8")).includes("old"));
    assert.equal((await integrationConfig("github")).credentials.token, "old");
    assert.deepEqual(await migrateIntegrationSecrets(), []);
  }));

await test("a failing keyring blocks writes instead of erasing the stored secret", () =>
  withData(async () => {
    const backend = fakeBackend();
    useIntegrationVault(createVault(backend, () => undefined));
    await updateIntegration("github", (config) => ({ ...config, credentials: { token: "keep" } }));
    const broken = fakeBackend();
    broken.get = async () => {
      throw new Error("locked");
    };
    broken.items = backend.items;
    useIntegrationVault(createVault(broken, () => undefined));
    await assert.rejects(
      updateIntegration("github", (config) => ({ ...config, enabled: false })),
      /locked/,
    );
    const read = await integrationConfig("github");
    assert.equal(read.credentialsError, "locked");
    assert.deepEqual(read.credentials, {});
    assert.equal(JSON.parse(backend.items.get("integration:github")).token, "keep");
  }));

await test("credentials can be revealed only while protected by the keyring", () =>
  withData(async () => {
    useIntegrationVault(createVault(fakeBackend({ available: false }), () => undefined));
    await updateIntegration("github", (config) => ({ ...config, credentials: { token: "plain" } }));
    assert.equal(await revealIntegrationCredential("github", "token"), undefined);

    useIntegrationVault(createVault(fakeBackend(), () => undefined));
    await updateIntegration("github", (config) => ({ ...config, credentials: { token: "safe" } }));
    assert.equal(await revealIntegrationCredential("github", "token"), "safe");
    assert.equal(await revealIntegrationCredential("github", "missing"), undefined);
  }));

// Touches the real user keyring (and may show an unlock dialog), so it is opt-in.
await test("OS secret store round-trips a value (PROJECTOR_TEST_KEYRING=1)", async (t) => {
  if (!process.env.PROJECTOR_TEST_KEYRING) return t.skip("нужен PROJECTOR_TEST_KEYRING=1");
  if (!(await os.secrets.available())) return t.skip("Secret Service недоступен");
  const key = { service: "projector-test", account: `roundtrip-${process.pid}` };
  try {
    await os.secrets.set(key, "Projector test", "значение");
    assert.equal(await os.secrets.get(key), "значение");
    await os.secrets.set(key, "Projector test", "second");
    assert.equal(await os.secrets.get(key), "second");
  } finally {
    await os.secrets.delete(key);
  }
  assert.equal(await os.secrets.get(key), undefined);
});
