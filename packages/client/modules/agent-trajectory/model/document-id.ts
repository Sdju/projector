let sequence = 0;

export function nextDocumentId(): string {
  sequence++;
  return `trajectory:${Date.now().toString(36)}:${sequence.toString(36)}`;
}
