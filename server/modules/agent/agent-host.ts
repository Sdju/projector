import { devcontainerForPath } from "../devcontainer/index.ts";
import { environmentForPath } from "../environments/index.ts";
import type { AgentHistoryTurn } from "../providers/index.ts";

/** Env names that must not leak from Projector's server into a coding agent's shell. */
const PRIVATE_ENV = [
  "PROVIDERS_SECRET",
  "OPENAI_API_KEY",
  "DASHSCOPE_API_KEY",
  "QWENCLOUD_API_KEY",
];

/** The host environment for an external coding agent, without Projector's own secrets. */
export function agentEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  for (const name of PRIVATE_ENV) delete env[name];
  return env;
}

/** Without a native session the earlier chat is replayed as text. */
export function promptWithHistory(message: string, history: AgentHistoryTurn[]): string {
  if (!history.length) return message;
  const transcript = history
    .slice(-10)
    .map((turn) => `${turn.role === "user" ? "Пользователь" : "Ассистент"}: ${turn.content}`)
    .join("\n\n");
  return `Предыдущая переписка в этом чате:\n\n${transcript}\n\nНовое сообщение пользователя:\n${message}`;
}

/** An external agent's tools run on the host, so isolating environments are refused. */
export async function assertHostProject(cwd: string, label: string): Promise<void> {
  if ((await devcontainerForPath(cwd)) || (await environmentForPath(cwd)))
    throw new Error(
      `${label} выполняет инструменты на машине пользователя и недоступен в проектах с Docker-окружением или Dev Container. Откройте терминальную сессию.`,
    );
}
