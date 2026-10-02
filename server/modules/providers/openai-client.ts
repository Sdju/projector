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

export function createQwenOpenAI(options: { openaiUrl: string; openaiApiKey?: string }) {
  return createOpenAICompatible({
    name: "qwen-openai",
    baseURL: normalizeOpenAiBaseUrl(options.openaiUrl),
    apiKey: options.openaiApiKey?.trim() || "not-needed",
  });
}
