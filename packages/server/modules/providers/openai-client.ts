import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export function normalizeOpenAiBaseUrl(rawUrl: string): string {
  const withProtocol = /^https?:\/\//i.test(rawUrl) ? rawUrl : `http://${rawUrl}`;
  const url = new URL(withProtocol);
  const pathname = url.pathname.replace(/\/+$/, "");

  if (!/\/v\d+[a-z0-9]*(\/|$)/i.test(pathname)) {
    url.pathname = `${pathname}/v1`;
  }

  return url.toString().replace(/\/+$/, "");
}

interface RawUsage {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  prompt_tokens_details?: {
    cached_tokens?: number | null;
    cache_write_tokens?: number | null;
  } | null;
  completion_tokens_details?: { reasoning_tokens?: number | null } | null;
  /** DeepSeek reports its prefix cache here instead of in `prompt_tokens_details`. */
  prompt_cache_hit_tokens?: number | null;
}

/** Token accounting of OpenAI-compatible servers, including the cache fields providers add. */
export function convertUsage(usage: RawUsage | null | undefined) {
  const prompt = usage?.prompt_tokens ?? 0;
  const completion = usage?.completion_tokens ?? 0;
  const cacheRead =
    usage?.prompt_tokens_details?.cached_tokens ?? usage?.prompt_cache_hit_tokens ?? 0;
  const cacheWrite = usage?.prompt_tokens_details?.cache_write_tokens ?? 0;
  const reasoning = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  return {
    inputTokens: {
      total: prompt,
      noCache: Math.max(0, prompt - cacheRead - cacheWrite),
      cacheRead,
      cacheWrite,
    },
    outputTokens: {
      total: completion,
      text: Math.max(0, completion - reasoning),
      reasoning,
    },
    raw: (usage ?? undefined) as never,
  };
}

export function createQwenOpenAI(options: { openaiUrl: string; openaiApiKey?: string }) {
  return createOpenAICompatible({
    convertUsage,
    name: "qwen-openai",
    baseURL: normalizeOpenAiBaseUrl(options.openaiUrl),
    apiKey: options.openaiApiKey?.trim() || "not-needed",
  });
}
