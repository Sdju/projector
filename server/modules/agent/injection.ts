/** Messages the user adds while an answer is running, by the ID of the message that started it. */
const injectors = new Map<string, (text: string) => boolean>();

/** Adds a message to the answer running for `messageId`; `false` when it has already finished. */
export function injectMessage(messageId: string, text: string): boolean {
  return injectors.get(messageId)?.(text) ?? false;
}

/** A run that can take messages mid-answer registers how to add one; the returned function forgets it. */
export function registerInjector(messageId: string, inject: (text: string) => boolean): () => void {
  injectors.set(messageId, inject);
  return () => {
    if (injectors.get(messageId) === inject) injectors.delete(messageId);
  };
}
