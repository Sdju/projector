/** FNV-1a over the text: a cheap check that a saved doctor outcome belongs to this text. */
export function textFingerprint(text: string): number {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at++) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
