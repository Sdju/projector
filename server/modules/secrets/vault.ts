import { os } from "../../../core/modules/os/index.ts";
import type { SecretKey } from "../../../core/modules/os/index.ts";

export interface SecretBackend {
  available(): Promise<boolean>;
  get(key: SecretKey): Promise<string | undefined>;
  set(key: SecretKey, label: string, value: string): Promise<void>;
  delete(key: SecretKey): Promise<void>;
}
export type SecretStorage =
  | { backend: "keyring" }
  | { backend: "file"; reason: "disabled" | "unavailable" };

const SERVICE = "projector";
const READ_TTL = 60_000;
const RETRY_AFTER = 30_000;

/**
 * Secrets live in the OS keyring when one is reachable; callers keep a plain-file
 * fallback and must never treat an unreadable keyring entry as an empty one.
 */
export function createVault(
  backend: SecretBackend = os.secrets,
  mode: () => string | undefined = () => process.env.PROJECTOR_SECRET_STORE,
) {
  let probe: { at: number; ok: boolean } | undefined;
  const cache = new Map<string, { at: number; value: string | undefined }>();
  const key = (name: string): SecretKey => ({ service: SERVICE, account: name });
  // Temporary XDG directories do not isolate Secret Service: its keys are global.
  // Tests must inject a backend instead of accessing production credentials.
  const isolatedTest = () => backend === os.secrets && !!process.env.NODE_TEST_CONTEXT;
  function allowAccess() {
    if (isolatedTest()) throw new Error("Tests cannot access the Projector system keyring");
  }

  async function storage(): Promise<SecretStorage> {
    if (isolatedTest() || mode() === "file") return { backend: "file", reason: "disabled" };
    const now = Date.now();
    if (!probe || (!probe.ok && now - probe.at > RETRY_AFTER))
      probe = { at: now, ok: await backend.available() };
    return probe.ok ? { backend: "keyring" } : { backend: "file", reason: "unavailable" };
  }
  return {
    storage,
    async get(name: string): Promise<string | undefined> {
      allowAccess();
      const hit = cache.get(name);
      if (hit && Date.now() - hit.at < READ_TTL) return hit.value;
      const value = await backend.get(key(name));
      cache.set(name, { at: Date.now(), value });
      return value;
    },
    async set(name: string, label: string, value: string): Promise<void> {
      allowAccess();
      await backend.set(key(name), label, value);
      cache.set(name, { at: Date.now(), value });
    },
    async delete(name: string): Promise<void> {
      allowAccess();
      await backend.delete(key(name));
      cache.delete(name);
    },
  };
}
export const vault = createVault();
