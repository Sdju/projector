/** How the workspace registers one of its commands (the same call as for its own). */
export type RegisterCommand = (
  id: string,
  title: string,
  run: (args?: unknown) => unknown,
  enabled: (args?: unknown) => boolean,
  requires?: undefined,
  meta?: { description?: string; arguments?: Record<string, string> },
) => unknown;
