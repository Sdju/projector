import { join } from "node:path";
import type { JudgeOverride } from "@ai-projector/core/modules/agent-judge/index.ts";
import type { AgentRoleSnapshot } from "@ai-projector/core/modules/agent-role/index.ts";
import type { AgentHistoryTool, AgentHistoryTurn } from "../providers/index.ts";
import type { AgentSelection } from "./controls.ts";
import type { AgentBackendId, AgentPermissionMode, FileRange, MessagePart } from "./backend.ts";
import {
  isBoolean,
  isCount,
  isRecord,
  isStringMap,
  isText,
  isTextList,
  optionalField,
  readStateFile,
  type ParsedState,
} from "./state-file.ts";

/** What a restarted server needs to repeat a run and so rejoin its answer in progress. */
export interface AgentRunRecord {
  backend: AgentBackendId;
  message: string;
  parts?: MessagePart[];
  history: AgentHistoryTurn[];
  /** Feature ids chosen for the chat; absent means the user's defaults. */
  features?: string[];
  /** The chat's own Judge settings; absent means the global ones. */
  judge?: JudgeOverride;
  cwd?: string;
  sessionId?: string;
  messageId?: string;
  tail?: string;
  selection?: AgentSelection;
  permissionMode?: AgentPermissionMode;
  /** The role the run belongs to, when a job or a future task started it. */
  role?: AgentRoleSnapshot;
  providerId?: string;
  /** The client can show permission and question prompts (its answers come back to the run). */
  approvals?: boolean;
  /** The client can run Projector commands for the agent. */
  commandBridge?: boolean;
  /** The project and chat the run belongs to, so any page can tell what works right now. */
  projectId?: string;
  chat?: string;
  /** The agent's own session of the run, once it reported it: a reopened session finds its live run by it. */
  session?: string;
  /** When the run started (ms since the epoch), for the elapsed time in the overview. */
  startedAt?: number;
}

const TEXT_FIELDS = [
  "cwd",
  "sessionId",
  "messageId",
  "tail",
  "permissionMode",
  "providerId",
  "projectId",
  "chat",
  "session",
] as const;
const FLAG_FIELDS = ["approvals", "commandBridge"] as const;

const JUDGE_CONFIDENCE = new Set(["high", "high-medium"]);
const isJudgeRisk = (value: unknown): boolean => value === 1 || value === 2 || value === 3;

/** Настройки Judge у чата: известные поля должны быть годными, лишние типу не мешают. */
export function isJudgeOverride(value: unknown): value is JudgeOverride {
  if (!isRecord(value)) return false;
  if (!optionalField(value, "show", isBoolean)) return false;
  if (!optionalField(value, "auto", isBoolean)) return false;
  if (!optionalField(value, "maxRisk", isJudgeRisk)) return false;
  return optionalField(value, "confidence", (item) => JUDGE_CONFIDENCE.has(item as string));
}

const ROLE_PERMISSION_MODES = new Set(["default", "auto", "bypassPermissions"]);

/** Снимок роли из истории чата: без годного выбора модели ход нельзя повторить как был. */
export function isAgentRoleSnapshot(value: unknown): value is AgentRoleSnapshot {
  if (!isRecord(value)) return false;
  if (!isText(value.roleId) || !value.roleId) return false;
  if (!isText(value.name) || !value.name) return false;
  if (!isStringMap(value.selection)) return false;
  if (!optionalField(value, "permissionMode", (item) => ROLE_PERMISSION_MODES.has(item as string)))
    return false;
  if (!optionalField(value, "prompt", isText)) return false;
  if (!optionalField(value, "template", isBoolean)) return false;
  for (const key of ["skills", "mcp"] as const)
    if (!optionalField(value, key, isTextList)) return false;
  return true;
}

const isFileRange = (value: unknown): value is FileRange =>
  isRecord(value) && isCount(value.from) && isCount(value.to);

/** Один фрагмент сообщения пользователя: файл, картинка, команда или текст. */
export function isMessagePart(value: unknown): value is MessagePart {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case "text":
      return isText(value.text);
    case "file":
      return (
        isText(value.path) &&
        value.path.length > 0 &&
        optionalField(value, "directory", isBoolean) &&
        optionalField(value, "range", isFileRange)
      );
    case "image":
      return isText(value.id) && isText(value.name) && isText(value.mime);
    case "command":
      return isText(value.name) && value.name.length > 0;
    default:
      return false;
  }
}

/**
 * Проверяет запись `run.json`. Ход повторяют после перезапуска сервера и читает отдельный процесс
 * (`hosted-runner`), поэтому запись проверяется целиком: без обязательных полей ход продолжить
 * нельзя, а негодный элемент истории нельзя выбросить, не изменив разговор молча. Неверная форма
 * означает испорченный файл, а не частично валидную запись.
 */
export function parseRunRecord(value: unknown): ParsedState<AgentRunRecord> | undefined {
  if (!isRecord(value)) return;
  if (!isText(value.backend) || !value.backend) return;
  if (!isText(value.message)) return;
  if (!Array.isArray(value.history) || !value.history.every(isAgentHistoryTurn)) return;
  if (!optionalField(value, "parts", (item) => Array.isArray(item) && item.every(isMessagePart)))
    return;
  if (!optionalField(value, "features", isTextList)) return;
  if (!optionalField(value, "judge", isJudgeOverride)) return;
  if (!optionalField(value, "role", isAgentRoleSnapshot)) return;
  if (!optionalField(value, "selection", isStringMap)) return;
  for (const key of TEXT_FIELDS) if (!optionalField(value, key, isText)) return;
  for (const key of FLAG_FIELDS) if (!optionalField(value, key, isBoolean)) return;
  if (!optionalField(value, "startedAt", isCount)) return;
  return { value: value as unknown as AgentRunRecord };
}

/**
 * Запись хода для процесса, который его ведёт: без неё продолжать нельзя, поэтому отсутствие,
 * повреждение и неверная форма — ошибка с понятным сообщением, а не тихий запуск без настроек.
 * Повреждённый файл при этом откладывается рядом, чтобы следующая запись сервера его не затёрла.
 */
export async function requireRunRecord(directory: string): Promise<AgentRunRecord> {
  const read = await readStateFile(join(directory, "run.json"), "Файл запуска", parseRunRecord);
  if (read.status === "ok") return read.value;
  throw new Error(
    read.status === "missing"
      ? "Нет файла запуска run.json"
      : `Файл запуска run.json непригоден: ${read.problem}`,
  );
}

export function isAgentHistoryTool(value: unknown): value is AgentHistoryTool {
  if (!isRecord(value)) return false;
  return (
    isText(value.id) &&
    isText(value.name) &&
    isText(value.output) &&
    optionalField(value, "input", isText) &&
    optionalField(value, "failed", isBoolean)
  );
}

export function isAgentHistoryTurn(value: unknown): value is AgentHistoryTurn {
  if (!isRecord(value)) return false;
  if (value.role !== "user" && value.role !== "assistant") return false;
  if (!isText(value.content)) return false;
  if (!optionalField(value, "thoughts", isText)) return false;
  if (
    !optionalField(value, "tools", (item) => Array.isArray(item) && item.every(isAgentHistoryTool))
  )
    return false;
  return true;
}
