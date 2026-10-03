/** `dev` — Vite с HMR, `prod` — собранный `dist` через `vp preview`. */
export type ServerMode = "dev" | "prod";

export const SERVER_MODES: readonly ServerMode[] = ["dev", "prod"];

export function isServerMode(value: unknown): value is ServerMode {
  return value === "dev" || value === "prod";
}

/** Аргументы `vp` для запуска сервера в режиме. */
export function serverCommand(mode: ServerMode): string[] {
  return [mode === "prod" ? "preview" : "dev"];
}
