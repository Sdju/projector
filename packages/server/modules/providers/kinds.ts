import type { BuiltinProviderKind, ProviderKind } from "./types.ts";

export const BUILTIN_PROVIDER_KINDS: readonly BuiltinProviderKind[] = [
  "custom",
  "local",
  "deepseek",
  "qwencloud",
];

/** A kind that can safely live in providers.json; plugin kinds use the same alphabet. */
const PROVIDER_KIND_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;

export function isProviderKind(value: unknown): value is ProviderKind {
  return typeof value === "string" && PROVIDER_KIND_PATTERN.test(value);
}

export function isBuiltinProviderKind(value: unknown): value is BuiltinProviderKind {
  return typeof value === "string" && BUILTIN_PROVIDER_KINDS.includes(value as BuiltinProviderKind);
}

const LOCAL_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[^.]+\.local)$/i;

/** Kind of a provider saved before kinds existed, guessed from its URL. */
export function inferProviderKind(url: string): ProviderKind {
  const value = url.trim().toLowerCase();
  if (!value) return "custom";
  if (value.includes("deepseek.com")) return "deepseek";
  if (value.includes("dashscope") || value.includes("aliyuncs.com") || value.includes("qwencloud"))
    return "qwencloud";
  try {
    const host = new URL(/^https?:\/\//.test(value) ? value : `http://${value}`).hostname;
    if (LOCAL_HOST.test(host)) return "local";
  } catch {
    // An unparsable URL is just a custom provider.
  }
  return "custom";
}
