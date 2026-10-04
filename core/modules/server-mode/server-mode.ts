/** `dev` — Vite с HMR, `prod` — собранный `dist` на собственном Node-сервере (`server/app/standalone.ts`). */
export type ServerMode = "dev" | "prod";

export const SERVER_MODES: readonly ServerMode[] = ["dev", "prod"];

export function isServerMode(value: unknown): value is ServerMode {
  return value === "dev" || value === "prod";
}

/** Команда запуска сервера: dev — `vp dev`, prod — Node без `vp`. */
export function serverCommand(
  mode: ServerMode,
  options: { vp: string; node: string; root: string },
): { command: string; args: string[] } {
  if (mode === "prod")
    return { command: options.node, args: [`${options.root}/server/app/standalone.ts`] };
  return { command: options.vp, args: ["dev"] };
}
