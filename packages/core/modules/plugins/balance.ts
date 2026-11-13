import { assertAllowedKeys, assertRecord, assertText } from "./agent.ts";

/**
 * A provider kind whose money balance a trusted plugin knows how to read. The kind becomes
 * selectable in the provider settings and its `read()` implementation is registered through
 * `api.providers.registerBalance`.
 */
export interface PluginBalanceContribution {
  /** Provider kind id; built-in kinds are reserved. */
  kind: string;
  /** Label of the kind in the provider settings. */
  title: string;
  description?: string;
  /** URL and model offered when the user adds a provider of this kind. */
  url?: string;
  model?: string;
}

const providerKindPattern = /^[a-z][a-z0-9._-]{0,63}$/;
const builtinProviderKinds = new Set(["custom", "local", "deepseek", "openrouter", "qwencloud"]);

/** A provider kind a plugin brings its own balance reader for; built-ins stay Projector's. */
export function validateBalanceContribution(
  value: unknown,
  seen: Set<string>,
): PluginBalanceContribution {
  assertRecord(value, "Провайдер баланса плагина");
  assertAllowedKeys(
    value,
    ["kind", "title", "description", "url", "model"],
    "Провайдер баланса плагина",
  );
  if (typeof value.kind !== "string" || !providerKindPattern.test(value.kind))
    throw new Error("Некорректный вид провайдера баланса");
  if (builtinProviderKinds.has(value.kind))
    throw new Error("Вид провайдера баланса зарезервирован Projector");
  if (seen.has(value.kind)) throw new Error("Повторяющийся вид провайдера баланса");
  seen.add(value.kind);
  assertText(value.title, "Название вида провайдера баланса", 120);
  if (value.description !== undefined)
    assertText(value.description, "Описание вида провайдера баланса", 1000);
  if (value.url !== undefined) assertText(value.url, "URL вида провайдера баланса", 500);
  if (value.model !== undefined) assertText(value.model, "Модель вида провайдера баланса", 200);
  return value as unknown as PluginBalanceContribution;
}
