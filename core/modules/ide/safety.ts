const CHANGING = new Set(
  "delete remove rm clear kill stop reset discard revert push pull commit stage unstage merge clone install uninstall password run exec start restart save import write create new rename move add set apply send input login logout shell prune build up down".split(
    " ",
  ),
);
const LOOKING = new Set(
  "read result list get info search refresh describe status find more filter open toggle focus show copy recent".split(
    " ",
  ),
);

/**
 * Commands that only look at or open something do not need the user's permission. The words of a
 * command id are split at dots, dashes, underscores and camel-case boundaries.
 */
export function commandIsSafe(command: string): boolean {
  const words = command.split(/[.\-_]|(?<=[a-z])(?=[A-Z])/).map((word) => word.toLowerCase());
  return words.some((word) => LOOKING.has(word)) && !words.some((word) => CHANGING.has(word));
}
