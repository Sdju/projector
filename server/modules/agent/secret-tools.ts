import { z } from "zod";
import type { SecretRequest } from "./command-bridge.ts";
import {
  destinationOf,
  gitIgnores,
  resolveEnvTarget,
  resolveIntegrationTarget,
  resolveProviderTarget,
  storeSecret,
  type SecretTarget,
} from "./secret-destination.ts";
import { defineSpec, type ToolSpec } from "./tool-spec.ts";

export interface SecretToolContext {
  cwd?: string;
  /** Shows the secret form and resolves the typed value, `null` when the user declines. */
  secret: (request: SecretRequest) => Promise<string | null>;
}

/** One tool for every kind of secret: the model names the destination, the user types the value. */
export function createSecretToolSpecs(context: SecretToolContext): ToolSpec[] {
  /** Checks the destination, asks for the value, stores it. Nothing is asked if the check fails. */
  async function resolve(input: Record<string, unknown>): Promise<SecretTarget> {
    const str = (value: unknown) => (typeof value === "string" ? value : undefined);
    switch (input.kind) {
      case "env": {
        if (!str(input.key)) throw new Error("Для kind env укажите key — имя переменной");
        return resolveEnvTarget(context.cwd, str(input.file) || ".env", str(input.key)!);
      }
      case "ai_provider":
        return resolveProviderTarget({
          providerId: str(input.providerId),
          name: str(input.name),
          url: str(input.url),
          model: str(input.model),
        });
      case "integration":
        if (input.integration !== "github" && input.integration !== "gitlab")
          throw new Error("Для kind integration укажите github или gitlab");
        return resolveIntegrationTarget(input.integration);
      default:
        throw new Error("kind: env, ai_provider или integration");
    }
  }

  return [
    defineSpec({
      name: "request_secret",
      description:
        "Запросить у пользователя секрет и записать его напрямую в место назначения. Пользователь вводит значение в закрытом поле; тебе возвращается только факт записи, сам секрет нет. kind=env — переменная .env проекта (key, file). kind=ai_provider — ключ провайдера: providerId существующего или name, url, model нового; адрес не должен быть придуман. kind=integration — токен github или gitlab. Места и провайдеры узнай через list_secret_destinations. Значение не угадывай и не придумывай.",
      shape: {
        kind: z.enum(["env", "ai_provider", "integration"]).describe("Куда записать"),
        label: z.string().max(200).optional().describe("Что за секрет, в словах пользователя"),
        reason: z.string().max(500).optional().describe("Зачем он нужен"),
        key: z.string().optional().describe("env: имя переменной, например DATABASE_PASSWORD"),
        file: z.string().optional().describe("env: файл относительно проекта, по умолчанию .env"),
        providerId: z.string().optional().describe("ai_provider: id существующего провайдера"),
        name: z.string().max(80).optional().describe("ai_provider: название нового провайдера"),
        url: z
          .string()
          .max(500)
          .optional()
          .describe("ai_provider: адрес API нового провайдера, http или https"),
        model: z.string().max(200).optional().describe("ai_provider: модель по умолчанию"),
        integration: z.enum(["github", "gitlab"]).optional().describe("integration: какой токен"),
      },
      run: async (input) => {
        const target = await resolve(input);
        const value = await context.secret({
          label: (input.label as string | undefined) || defaultLabel(target),
          reason: input.reason as string | undefined,
          destination: destinationOf(target),
        });
        if (value === null) return { stored: false, declined: true };
        await storeSecret(target, value);
        if (target.kind === "env_file")
          return {
            stored: true,
            kind: "env",
            file: target.file,
            key: target.key,
            replaced: target.replaces,
            gitIgnored: context.cwd ? await gitIgnores(context.cwd, target.path) : undefined,
          };
        if (target.kind === "ai_provider")
          return {
            stored: true,
            kind: "ai_provider",
            providerId: target.id,
            name: target.name,
            replaced: target.replaces,
          };
        return {
          stored: true,
          kind: "integration",
          integration: target.integration,
          replaced: target.replaces,
        };
      },
    }),
  ];
}

function defaultLabel(target: SecretTarget): string {
  if (target.kind === "env_file") return `Переменная ${target.key}`;
  if (target.kind === "ai_provider") return `Ключ провайдера «${target.name}»`;
  return `Токен ${target.label}`;
}
