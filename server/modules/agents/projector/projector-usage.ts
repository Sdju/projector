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

/** What a million tokens cost; the cache prices default to the price of an ordinary input token. */
export interface Price {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** The cost of the tokens at the model's price, in the currency of its tariff. */
export function costOf(tokens: Tokens, price: Price): number {
  return (
    (tokens.input * price.input +
      tokens.cacheRead * (price.cacheRead ?? price.input) +
      tokens.cacheWrite * (price.cacheWrite ?? price.input) +
      tokens.output * price.output) /
    1_000_000
  );
}
