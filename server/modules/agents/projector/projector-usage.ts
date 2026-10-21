/** Token counts of a request as the SDK reports them. */
interface SdkUsage {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: {
    noCacheTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** `input` counts the prompt tokens the cache did not serve, as in the usage tooltip of the chat. */
export function tokensOf(usage: SdkUsage | undefined): Tokens {
  const details = usage?.inputTokenDetails;
  const cacheRead = details?.cacheReadTokens ?? 0;
  const cacheWrite = details?.cacheWriteTokens ?? 0;
  const prompt = usage?.inputTokens ?? 0;
  return {
    input: details?.noCacheTokens ?? Math.max(0, prompt - cacheRead - cacheWrite),
    output: usage?.outputTokens ?? 0,
    cacheRead,
    cacheWrite,
  };
}
