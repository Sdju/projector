/**
 * Flat key-value storage of one plugin package. The same rules apply on both sides: the browser
 * runtime validates before a request, the server enforces them before a write. Keys are names,
 * never paths: the package directory comes from `pluginPackageKey`, not from the caller.
 */

/** Size of the serialized `state.json`; the quota covers all keys of one package together. */
export const pluginStorageMaxBytes = 1_000_000;

export const pluginStorageMaxKeyLength = 200;

/** Assigning these names would reach the prototype instead of adding a key. */
const reservedKeys = new Set(["__proto__", "constructor", "prototype"]);

export interface PluginStorageDocument {
  version: 1;
  data: Record<string, unknown>;
}

/** Returns the key unchanged or throws; a key is a flat name without control characters. */
export function pluginStorageKey(value: unknown): string {
  if (typeof value !== "string") throw new Error("Ключ хранилища плагина должен быть строкой");
  if (!value || value.length > pluginStorageMaxKeyLength)
    throw new Error(`Ключ хранилища плагина: от 1 до ${pluginStorageMaxKeyLength} символов`);
  if (
    [...value].some((character) => (character.codePointAt(0) ?? 0) < 0x20 || character === "\u007f")
  )
    throw new Error("Ключ хранилища плагина не должен содержать управляющих символов");
  if (reservedKeys.has(value)) throw new Error(`Ключ хранилища плагина ${value} зарезервирован`);
  return value;
}

/** The value must survive a JSON round trip; `undefined` is a delete, not a value. */
export function serializePluginStorageValue(value: unknown): string {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    throw new Error("Значение хранилища плагина должно быть сериализуемым в JSON");
  }
  if (text === undefined)
    throw new Error("Значение хранилища плагина должно быть сериализуемым в JSON");
  return text;
}

/** Byte length, not character length: the quota is the size of the file on disk. */
export function pluginStorageBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function pluginStorageFits(text: string): boolean {
  return pluginStorageBytes(text) <= pluginStorageMaxBytes;
}

export function serializePluginStorage(data: Record<string, unknown>): string {
  return `${JSON.stringify({ version: 1, data } satisfies PluginStorageDocument)}\n`;
}

/** Returns the stored object or `null` when the file is damaged or has an unknown version. */
export function parsePluginStorage(text: string): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const document = value as Record<string, unknown>;
  if (document.version !== 1 || !document.data) return null;
  if (typeof document.data !== "object" || Array.isArray(document.data)) return null;
  const data: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(document.data)) {
    if (reservedKeys.has(key) || key.length > pluginStorageMaxKeyLength) continue;
    data[key] = entry;
  }
  return data;
}
