import type { ProviderBalanceEntry, ProviderKindInfo } from "./types.ts";

/** What a balance reader receives: the provider settings and a deadline for its upstream call. */
export interface ProviderBalanceContext {
  id: string;
  name: string;
  kind: string;
  url: string;
  apiKey: string;
  signal: AbortSignal;
}

/** A balance result before Projector adds the provider, timestamp and cache information. */
export interface ProviderBalanceReading {
  status: "ready" | "unavailable" | "unsupported";
  entries: ProviderBalanceEntry[];
  available: boolean | null;
  message: string | null;
}

/**
 * A balance reader for one provider kind. Built-in readers use the same contract as a trusted
 * plugin, so a new kind only has to register its own reader.
 */
export interface ProviderBalanceResolver {
  kind: string;
  title?: string;
  description?: string;
  /** URL and model offered when a provider of this kind is added. */
  url?: string;
  model?: string;
  /** Package that contributed the resolver; absent for built-in kinds. */
  plugin?: string;
  read(context: ProviderBalanceContext): Promise<ProviderBalanceReading> | ProviderBalanceReading;
}

const resolvers = new Map<string, ProviderBalanceResolver>();

/** Registers a reader for a kind; disposed when the owning plugin is disabled or reloaded. */
export function registerBalanceResolver(resolver: ProviderBalanceResolver): () => void {
  if (resolvers.has(resolver.kind)) throw new Error(`Вид провайдера уже занят: ${resolver.kind}`);
  resolvers.set(resolver.kind, resolver);
  return () => {
    if (resolvers.get(resolver.kind) === resolver) resolvers.delete(resolver.kind);
  };
}

export function balanceResolver(kind: string): ProviderBalanceResolver | undefined {
  return resolvers.get(kind);
}

/** Kinds contributed by plugins, for the provider settings; built-ins keep their client presets. */
export function pluginBalanceKinds(): ProviderKindInfo[] {
  return [...resolvers.values()]
    .filter((resolver) => resolver.plugin)
    .map((resolver) => ({
      kind: resolver.kind,
      title: resolver.title ?? resolver.kind,
      ...(resolver.description ? { description: resolver.description } : {}),
      ...(resolver.url ? { url: resolver.url } : {}),
      ...(resolver.model ? { model: resolver.model } : {}),
      ...(resolver.plugin ? { plugin: resolver.plugin } : {}),
    }))
    .sort((left, right) => left.title.localeCompare(right.title));
}
