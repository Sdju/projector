/** Server-sent events of `/api/events` that pages react to; `open` is reported by the transport. */
export const EVENT_NAMES = [
  "launcher-show",
  "status",
  "file-changed",
  "dir-changed",
  "watch-error",
  "terminal-started",
  "agent",
  "ide-command-request",
  "ide-command-cancel",
] as const;
