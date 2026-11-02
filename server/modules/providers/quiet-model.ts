import { defaultSettingsMiddleware, wrapLanguageModel } from "ai";
import type { LanguageModel } from "ai";
import { createQwenOpenAI } from "./openai-client.ts";
import { envFallbackFromProcess, resolveOpenAIProvider } from "./provider-store.ts";
import { quietThinkingBody } from "./thinking.ts";

/**
 * The chat's provider and model with thinking turned down: one cheap request, no tools and no
 * history. Used by the small Projector requests that sit beside the chat (Form Doctor, Lens).
 */
export async function quietChatModel(selection?: Record<string, string>): Promise<{
  model: LanguageModel;
  provider: string;
  name: string;
}> {
  const [providerId, ...rest] = (selection?.provider || "").split(":");
  const resolved = await resolveOpenAIProvider({
    providerId,
    model: rest.join(":"),
    fallback: envFallbackFromProcess(),
  });
  const provider = createQwenOpenAI({
    openaiUrl: resolved.url,
    openaiApiKey: resolved.apiKey,
  });
  const style = resolved.thinking === false ? "none" : resolved.thinkingStyle;
  const quiet = quietThinkingBody(style);
  const model = quiet
    ? wrapLanguageModel({
        model: provider.chatModel(resolved.model),
        middleware: defaultSettingsMiddleware({
          settings: { providerOptions: { qwenOpenai: quiet } },
        }),
      })
    : provider.chatModel(resolved.model);
  return { model, provider: resolved.id, name: resolved.modelName };
}
