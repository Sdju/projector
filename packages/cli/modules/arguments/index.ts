import type { InterfaceMode } from "@projector-ai/core/modules/launcher/index.ts";

export type CliCommand =
  | "open"
  | "projects"
  | "status"
  | "search"
  | "run"
  | "start"
  | "stop"
  | "restart"
  | "quit"
  | "toggle"
  | "mode"
  | "settings"
  | "logs"
  | "version"
  | "help";

export interface CliOptions {
  json: boolean;
  quiet: boolean;
  mode?: InterfaceMode;
  tray: boolean;
  toggle: boolean;
  quit: boolean;
  lan: boolean;
  local: boolean;
  server: boolean;
  command?: string;
  help: boolean;
  version: boolean;
}

export interface ParsedArgs {
  command: CliCommand;
  target?: string;
  options: CliOptions;
  rest: string[];
}

const COMMANDS: ReadonlySet<CliCommand> = new Set([
  "open",
  "projects",
  "status",
  "search",
  "run",
  "start",
  "stop",
  "restart",
  "quit",
  "toggle",
  "mode",
  "settings",
  "logs",
  "version",
  "help",
]);

const ALIASES: Readonly<Record<string, CliCommand>> = {
  list: "projects",
  ls: "projects",
  serve: "start",
};

const MODE_FLAGS: ReadonlyMap<string, InterfaceMode> = new Map([
  ["--native", "native"],
  ["--window", "window"],
  ["--browser", "browser"],
]);

const TARGET_COMMANDS: ReadonlySet<CliCommand> = new Set([
  "open",
  "run",
  "stop",
  "status",
  "mode",
  "search",
  "help",
]);

function commandOf(value: string): CliCommand | undefined {
  if (Object.hasOwn(ALIASES, value)) return ALIASES[value];
  return COMMANDS.has(value as CliCommand) ? (value as CliCommand) : undefined;
}

function valueAfter(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`Укажите значение для ${flag}`);
  return value;
}

/**
 * Parses both the historical launcher flags (`--browser`, `toggle`, `quit`, `mode prod`) and
 * the project commands (`open`, `projects`, `run`, `stop`, `status`, `search`).
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const options: CliOptions = {
    json: false,
    quiet: false,
    tray: false,
    toggle: false,
    quit: false,
    lan: false,
    local: false,
    server: false,
    help: false,
    version: false,
  };
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      positional.push(...argv.slice(index + 1));
      break;
    }
    if (arg === "--json") options.json = true;
    else if (arg === "--quiet" || arg === "-q") options.quiet = true;
    else if (MODE_FLAGS.has(arg)) options.mode = MODE_FLAGS.get(arg);
    else if (arg === "--tray") options.tray = true;
    else if (arg === "--toggle") options.toggle = true;
    else if (arg === "--quit") options.quit = true;
    else if (arg === "--lan") options.lan = true;
    else if (arg === "--local") options.local = true;
    else if (arg === "--server") options.server = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--version" || arg === "-v") options.version = true;
    else if (arg === "--command") {
      options.command = valueAfter(argv, index, arg);
      index += 1;
    } else if (arg.startsWith("--command=")) {
      options.command = arg.slice("--command=".length);
      if (!options.command) throw new Error("Укажите значение для --command");
    } else if (arg.startsWith("-")) throw new Error(`Неизвестный флаг: ${arg}`);
    else positional.push(arg);
  }

  let command: CliCommand = "open";
  let target: string | undefined;
  let rest: string[] = [];
  if (positional.length) {
    const [first, ...tail] = positional;
    const known = commandOf(first);
    if (known) {
      command = known;
      [target, ...rest] = tail;
    } else {
      target = first;
      rest = tail;
    }
  }
  if (options.quit) command = "quit";
  else if (options.toggle) command = "toggle";
  else if (options.server) command = "start";
  if (options.version) command = "version";
  else if (options.help) command = "help";

  if (command === "search") target = [target, ...rest].filter(Boolean).join(" ");
  else if (rest.length) throw new Error(`Лишние аргументы: ${rest.join(" ")}`);
  if (command === "help" && target) rest = [target];
  if (target && !TARGET_COMMANDS.has(command))
    throw new Error(`Команда ${command} не принимает аргумент: ${target}`);

  return { command, target, options, rest };
}

export function helpText(version = ""): string {
  const title = version ? `Projector CLI ${version}` : "Projector CLI";
  return `${title}

Использование:
  projector [options]                         открыть палитру
  projector open [проект] [options]           открыть проект или палитру
  projector projects [--json]                 список сохранённых проектов
  projector status [проект] [--json]          состояние сервера и проекта
  projector run [проект] [--command <id>]     запустить основную команду проекта
  projector stop [проект]                     остановить команду проекта
  projector search <запрос> [--json]          поиск по приложениям и проектам
  projector start [--server]                  запустить сервер без открытия окна
  projector restart                           перезапустить сервер
  projector quit                              завершить Projector и его процессы
  projector toggle                            показать или скрыть палитру
  projector mode [dev|prod]                   показать или переключить режим сервера
  projector settings                          открыть настройки
  projector logs                              показать путь к журналу сервера
  projector version                           показать версию
  projector help                              показать эту справку

Проект:
  локальный путь (в том числе . и ~/путь), имя или id проекта,
  gh:/owner/repository, gl:/<instance>/<group>/<project>.
  Без проекта run и stop используют текущую папку.

Параметры:
  --browser | --window | --native   режим интерфейса
  --tray                            запустить только трей
  --lan | --local                   разовый режим доступа к серверу
  --server                          сервер в foreground (для start)
  --command <id>                    команда проекта для run
  --json                            машиночитаемый вывод
  --quiet, -q                       без обычных сообщений
  --help, -h                        справка
  --version, -v                     версия

Примеры:
  projector open .
  projector open ~/code/app --window
  projector open gh:/owner/repository
  projector run . --command test
  projector status --json
  projector projects --json`;
}
