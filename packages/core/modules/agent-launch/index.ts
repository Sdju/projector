/**
 * Machine-local parameters of an agent process. The agent module or plugin manifest keeps the
 * default command; this override only replaces how the already registered backend is started on
 * this computer. It never adds a backend, changes its protocol or touches its trust.
 */
export interface AgentLaunchOverride {
  /** Executable name in `PATH` or an absolute path. */
  command?: string;
  /** Arguments after the command. An empty array means "no arguments". */
  args?: string[];
  /** Extra or replaced environment variables of the agent process. */
  env?: Record<string, string>;
}

/** Where the effective command came from: the override, a preferred binary or the descriptor. */
export type AgentLaunchSource = "override" | "binary" | "default";

export interface AgentLaunchPlan {
  command: string;
  args: string[];
  source: AgentLaunchSource;
}

/** One ACP backend as the launch settings show it. */
export interface AgentLaunchState {
  id: string;
  label: string;
  /** What runs without an override on this machine (a preferred binary counts as default). */
  default: AgentLaunchPlan;
  override?: AgentLaunchOverride;
  /** What will run now, with the override applied, and whether the command can be found. */
  effective: AgentLaunchPlan & { found: boolean; path?: string };
}

/** The whole machine-local launch settings as one response. */
export interface AgentLaunchSettingsView {
  file: string;
  agents: AgentLaunchState[];
}

export const AGENT_LAUNCH_LIMITS = {
  command: 1_000,
  args: 64,
  arg: 4_000,
  env: 64,
  envKey: 100,
  envValue: 4_000,
} as const;

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FORBIDDEN_ENV_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** A safe environment variable name for an agent process. */
export function isAgentLaunchEnvKey(key: string): boolean {
  return ENV_KEY.test(key) && !FORBIDDEN_ENV_KEYS.has(key);
}

function text(value: string, label: string, max: number): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} не может быть пустым`);
  if (trimmed.length > max) throw new Error(`${label}: не более ${max} символов`);
  if (/[\0\r\n]/.test(trimmed)) throw new Error(`${label}: переводы строк и NUL недопустимы`);
  return trimmed;
}

/**
 * Reads an override from a settings file, a request body or a command argument. An empty object
 * means "use the descriptor"; malformed fields make the whole override invalid instead of
 * silently starting another command.
 */
export function parseAgentLaunchOverride(value: unknown): AgentLaunchOverride | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error("Настройка запуска должна быть объектом");

  const row = value as Record<string, unknown>;
  let command: string | undefined;
  if (row.command !== undefined) {
    if (typeof row.command !== "string") throw new Error("command должен быть строкой");
    if (row.command.trim()) command = text(row.command, "command", AGENT_LAUNCH_LIMITS.command);
  }

  let args: string[] | undefined;
  if (row.args !== undefined) {
    if (!Array.isArray(row.args)) throw new Error("args должен быть массивом строк");
    if (row.args.length > AGENT_LAUNCH_LIMITS.args)
      throw new Error(`args: не более ${AGENT_LAUNCH_LIMITS.args} аргументов`);
    args = row.args.map((arg, index) => {
      if (typeof arg !== "string") throw new Error(`args[${index}] должен быть строкой`);
      return text(arg, `args[${index}]`, AGENT_LAUNCH_LIMITS.arg);
    });
  }

  let env: Record<string, string> | undefined;
  if (row.env !== undefined) {
    if (!row.env || typeof row.env !== "object" || Array.isArray(row.env))
      throw new Error("env должен быть объектом KEY=value");
    const entries = Object.entries(row.env);
    if (entries.length > AGENT_LAUNCH_LIMITS.env)
      throw new Error(`env: не более ${AGENT_LAUNCH_LIMITS.env} переменных`);
    env = {};
    for (const [key, raw] of entries) {
      if (!isAgentLaunchEnvKey(key) || key.length > AGENT_LAUNCH_LIMITS.envKey)
        throw new Error(`env: некорректное имя переменной ${key}`);
      if (typeof raw !== "string") throw new Error(`env.${key} должен быть строкой`);
      if (raw.length > AGENT_LAUNCH_LIMITS.envValue)
        throw new Error(`env.${key}: не более ${AGENT_LAUNCH_LIMITS.envValue} символов`);
      if (raw.includes("\0")) throw new Error(`env.${key}: NUL недопустим`);
      env[key] = raw;
    }
    if (!entries.length) env = undefined;
  }

  if (!command && !args && !env) return undefined;
  return {
    ...(command ? { command } : {}),
    ...(args ? { args } : {}),
    ...(env ? { env } : {}),
  };
}
