import { isPluginIconFile } from "./icon.ts";

/**
 * Declarative ACP agents of a local plugin. Every field is allowlisted here so a
 * manifest cannot smuggle shell strings, environment or protocol extensions.
 *
 * The assertion helpers below are the shared primitives of manifest validation;
 * `index.ts` imports them for theme and root checks. They are not re-exported
 * from the module entry.
 */

export interface PluginAgentTerminal {
  program?: string;
  executable?: string;
  title?: string;
}

export interface PluginAgentUsageCommand {
  kind: "command";
  command: string;
  args?: string[];
  timeoutMs?: number;
}

export interface PluginAgentContribution {
  id: string;
  title: string;
  caption?: string;
  icon?: string;
  program?: string;
  terminal?: PluginAgentTerminal;
  command: string;
  args?: string[];
  binary?: string;
  clientCapabilities?: Record<string, unknown>;
  usage?: PluginAgentUsageCommand | { kind: "none" };
  usageReporting?: string;
}

const agentIdPattern = /^[a-z0-9][a-z0-9._-]*$/;
const agentIconPattern = /^[a-z0-9-]+$/;
const usageReportingPattern = /^[a-z0-9][a-z0-9/_-]*$/;
const forbiddenJsonKeys = ["__proto__", "constructor", "prototype"] as const;
const maxClientCapabilitiesLength = 20000;
const agentFields =
  "id title caption icon program terminal command args binary clientCapabilities usage usageReporting".split(
    " ",
  );

export function assertRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} должен быть объектом`);
  }
}

export function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label}: неизвестные поля: ${unknown.join(", ")}`);
}

export function assertText(
  value: unknown,
  label: string,
  maxLength = 200,
): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} должен быть непустой строкой`);
  }
}

export function assertSafeText(
  value: unknown,
  label: string,
  maxLength = 1000,
): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxLength ||
    value.includes("\n") ||
    value.includes("\0")
  ) {
    throw new Error(
      `${label}: ожидается непустая строка до ${maxLength} символов без переводов строк и NUL`,
    );
  }
}

function assertPattern(value: unknown, pattern: RegExp, maxLength: number, message: string): void {
  if (typeof value !== "string" || value.length > maxLength || !pattern.test(value))
    throw new Error(message);
}

function validateAgentArgs(value: unknown, label: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new Error(`${label}: ожидается массив строк`);
  if (value.length > 64) throw new Error(`${label}: не более 64 аргументов`);
  value.forEach((arg, index) => assertSafeText(arg, `${label}[${index}]`));
}

function validateAgentClientCapabilities(value: unknown): void {
  assertRecord(value, "clientCapabilities агента");
  const forbidden = forbiddenJsonKeys.find((key) => Object.hasOwn(value, key));
  if (forbidden) throw new Error(`clientCapabilities агента: недопустимое поле ${forbidden}`);
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error("clientCapabilities агента должен быть JSON-объектом");
  }
  if (!serialized || serialized.length > maxClientCapabilitiesLength)
    throw new Error(
      `clientCapabilities агента: JSON не должен превышать ${maxClientCapabilitiesLength} символов`,
    );
}

function validateAgentUsage(value: unknown): void {
  assertRecord(value, "usage агента");
  if (value.kind === "none") {
    assertAllowedKeys(value, ["kind"], "usage агента");
    return;
  }
  if (value.kind !== "command") throw new Error("usage агента: kind должен быть command или none");
  assertAllowedKeys(value, ["kind", "command", "args", "timeoutMs"], "usage агента");
  assertSafeText(value.command, "usage.command агента");
  validateAgentArgs(value.args, "usage.args агента");
  const timeoutMs = value.timeoutMs;
  if (
    timeoutMs !== undefined &&
    (typeof timeoutMs !== "number" ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 100 ||
      timeoutMs > 60000)
  )
    throw new Error("usage.timeoutMs агента должен быть целым числом от 100 до 60000");
}

function validateAgentTerminal(value: unknown): void {
  assertRecord(value, "Терминал агента");
  assertAllowedKeys(value, ["program", "executable", "title"], "Терминал агента");
  if (value.program !== undefined) assertSafeText(value.program, "Терминал агента: program");
  if (value.executable !== undefined)
    assertSafeText(value.executable, "Терминал агента: executable");
  if (value.title !== undefined) assertText(value.title, "Название терминала агента", 200);
}

export function validateAgentContribution(value: unknown, ids: Set<string>): void {
  assertRecord(value, "Агент плагина");
  assertAllowedKeys(value, agentFields, "Агент плагина");
  if (typeof value.id !== "string" || !agentIdPattern.test(value.id))
    throw new Error("Некорректный идентификатор агента");
  if (ids.has(value.id)) throw new Error("Повторяющийся идентификатор агента");
  ids.add(value.id);
  assertText(value.title, "Название агента", 200);
  if (value.caption !== undefined) assertText(value.caption, "Подпись агента", 300);
  if (value.icon !== undefined) {
    if (typeof value.icon !== "string") throw new Error("Некорректная иконка агента");
    if (!isPluginIconFile(value.icon))
      assertPattern(value.icon, agentIconPattern, 50, "Некорректная иконка агента");
  }
  if (value.program !== undefined) {
    if (typeof value.program !== "string" || !agentIdPattern.test(value.program))
      throw new Error("Некорректная программа агента");
  }
  assertSafeText(value.command, "Команда агента");
  validateAgentArgs(value.args, "Аргументы агента");
  if (value.binary !== undefined) assertSafeText(value.binary, "Бинарник агента");
  if (value.terminal !== undefined) validateAgentTerminal(value.terminal);
  if (value.clientCapabilities !== undefined)
    validateAgentClientCapabilities(value.clientCapabilities);
  if (value.usage !== undefined) validateAgentUsage(value.usage);
  if (value.usageReporting !== undefined)
    assertPattern(value.usageReporting, usageReportingPattern, 100, "Некорректный usageReporting");
}
