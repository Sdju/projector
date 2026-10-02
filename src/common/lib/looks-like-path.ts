export function looksLikePath(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed || trimmed.includes("\n")) return false;
  if (/^(добавь|добавить|найди|найти|ищи|открой)\b/i.test(trimmed)) return false;
  return /^(~(?:\/|$)|\/|\.\/|\.\.\/)/.test(trimmed);
}
