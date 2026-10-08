import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { mkdtemp, readFile, writeFile, mkdir, stat, rm } from "node:fs/promises";
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
} from "../server/modules/integration-store/index.ts";

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

test("the default vault never reaches production secrets under the test runner", async () => {
  expect(process.env.VITEST).toBeTruthy();
  const previous = process.env.PROJECTOR_SECRET_STORE;
  process.env.PROJECTOR_SECRET_STORE = "keyring";
  let calls = 0;
  const guards = ["available", "get", "set", "delete"].map((method) =>
    vi.spyOn(os.secrets, method).mockImplementation(async () => {
      calls++;
      throw new Error("Production keyring reached");
    }),
  );
  onTestFinished(() => {
    guards.forEach((guard) => guard.mockRestore());
    if (previous === undefined) delete process.env.PROJECTOR_SECRET_STORE;
    else process.env.PROJECTOR_SECRET_STORE = previous;
  });
  const vault = createVault();
  expect((await vault.storage()).backend).toBe("file");
  await expect(vault.get("integration:github")).rejects.toThrow(/Tests cannot access/);
  await expect(vault.set("integration:github", "test", "replacement")).rejects.toThrow(
    /Tests cannot access/,
  );
  await expect(vault.delete("integration:github")).rejects.toThrow(/Tests cannot access/);
  expect(calls).toBe(0);
});
async function withData(run) {
  const root = await mkdtemp(join(tmpdir(), "projector-secrets-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = root;
  try {
    await run(join(root, "projector", "integrations.json"));
  } finally {
    useIntegrationVault(createVault(fakeBackend({ available: false })));
    await rm(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
  }
}

test("credentials are stored in the keyring and never in the file", () =>
  withData(async (file) => {
    const backend = fakeBackend();
    useIntegrationVault(createVault(backend, () => undefined));
    await updateIntegration("github", (config) => ({
      ...config,
      enabled: true,
      credentials: { token: "ghp_secret", login: "octocat" },
    }));
    const text = await readFile(file, "utf8");
    expect(!text.includes("ghp_secret")).toBeTruthy();
    expect(JSON.parse(text).integrations.github.vault).toBe("keyring");
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await integrationConfig("github")).credentials.token).toBe("ghp_secret");

    await updateIntegration("github", (config) => ({ ...config, credentials: {} }));
    expect(backend.items.size).toBe(0);
    expect(JSON.parse(await readFile(file, "utf8")).integrations.github.vault).toBe(undefined);
  }));

test("file fallback keeps working without a keyring or when disabled", () =>
  withData(async (file) => {
    for (const [backend, mode] of [
      [fakeBackend({ available: false }), undefined],
      [fakeBackend(), "file"],
    ]) {
      useIntegrationVault(createVault(backend, () => mode));
      await updateIntegration("github", (config) => ({ ...config, credentials: { token: "t" } }));
      expect(JSON.parse(await readFile(file, "utf8")).integrations.github.credentials.token).toBe(
        "t",
      );
      expect(backend.items.size).toBe(0);
    }
  }));

test("plaintext credentials migrate once the keyring is reachable", () =>
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
    expect(await migrateIntegrationSecrets()).toStrictEqual(["github"]);
    expect(!(await readFile(file, "utf8")).includes("old")).toBeTruthy();
    expect((await integrationConfig("github")).credentials.token).toBe("old");
    expect(await migrateIntegrationSecrets()).toStrictEqual([]);
  }));

test("a failing keyring blocks writes instead of erasing the stored secret", () =>
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
    await expect(
      updateIntegration("github", (config) => ({ ...config, enabled: false })),
    ).rejects.toThrow(/locked/);
    const read = await integrationConfig("github");
    expect(read.credentialsError).toBe("locked");
    expect(read.credentials).toStrictEqual({});
    expect(JSON.parse(backend.items.get("integration:github")).token).toBe("keep");
  }));

test("credentials can be revealed only while protected by the keyring", () =>
  withData(async () => {
    useIntegrationVault(createVault(fakeBackend({ available: false }), () => undefined));
    await updateIntegration("github", (config) => ({ ...config, credentials: { token: "plain" } }));
    expect(await revealIntegrationCredential("github", "token")).toBe(undefined);

    useIntegrationVault(createVault(fakeBackend(), () => undefined));
    await updateIntegration("github", (config) => ({ ...config, credentials: { token: "safe" } }));
    expect(await revealIntegrationCredential("github", "token")).toBe("safe");
    expect(await revealIntegrationCredential("github", "missing")).toBe(undefined);
  }));

// Touches the real user keyring (and may show an unlock dialog), so it is opt-in.
test("OS secret store round-trips a value (PROJECTOR_TEST_KEYRING=1)", async (t) => {
  if (!process.env.PROJECTOR_TEST_KEYRING) return t.skip("нужен PROJECTOR_TEST_KEYRING=1");
  if (!(await os.secrets.available())) return t.skip("системное хранилище секретов недоступно");
  const key = { service: "projector-test", account: `roundtrip-${process.pid}` };
  try {
    await os.secrets.set(key, "Projector test", "значение");
    expect(await os.secrets.get(key)).toBe("значение");
    await os.secrets.set(key, "Projector test", "second");
    expect(await os.secrets.get(key)).toBe("second");
  } finally {
    await os.secrets.delete(key);
  }
  expect(await os.secrets.get(key)).toBe(undefined);
});
