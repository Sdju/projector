import type { ProviderKindInfo } from "./types.ts";

export interface ProviderUsageQuota {
  modelId: string;
  remaining: string | null;
  total: string | null;
  unit: string | null;
  percent: number | null;
  status: string | null;
}

/** Расход и квоты провайдера; это не остаток кошелька. */
export interface ProviderUsage {
  status: "ready" | "unavailable";
  period: { from: string; to: string } | null;
  currency: string | null;
  spend: string | null;
  quotas: ProviderUsageQuota[];
  plan: string | null;
  credits: { total: number; remaining: number } | null;
  checkedAt: number;
  message: string | null;
}

export interface ProviderUsageContext {
  id: string;
  name: string;
  kind: string;
  url: string;
  apiKey: string;
  signal: AbortSignal;
}

/** Читатель расхода одного вида провайдера. */
export interface ProviderUsageResolver {
  kind: string;
  title?: string;
  description?: string;
  read(context: ProviderUsageContext): Promise<ProviderUsage> | ProviderUsage;
}

const resolvers = new Map<string, ProviderUsageResolver>();

export function registerProviderUsage(resolver: ProviderUsageResolver): () => void {
  if (resolvers.has(resolver.kind)) throw new Error(`Расход вида уже занят: ${resolver.kind}`);
  resolvers.set(resolver.kind, resolver);
  return () => {
    if (resolvers.get(resolver.kind) === resolver) resolvers.delete(resolver.kind);
  };
}

export function providerUsageResolver(kind: string): ProviderUsageResolver | undefined {
  return resolvers.get(kind);
}

export function providerUsageKinds(): ProviderKindInfo[] {
  return [...resolvers.values()]
    .map((resolver) => ({
      kind: resolver.kind,
      title: resolver.title ?? resolver.kind,
      ...(resolver.description ? { description: resolver.description } : {}),
    }))
    .sort((left, right) => left.title.localeCompare(right.title));
}
