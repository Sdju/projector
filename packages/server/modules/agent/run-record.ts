import { join } from "node:path";
import type { JudgeOverride } from "@ai-projector/core/modules/agent-judge/index.ts";
import type { AgentRoleSnapshot } from "@ai-projector/core/modules/agent-role/index.ts";
import type { AgentHistoryTurn } from "../providers/index.ts";
import type { AgentSelection } from "./controls.ts";
import type { AgentBackendId, AgentPermissionMode, MessagePart } from "./backend.ts";
import {
  isCount,
  isRecord,
  isText,
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
const OBJECT_FIELDS = ["judge", "role", "selection"] as const;

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
  if (!optionalField(value, "parts", Array.isArray)) return;
  if (!optionalField(value, "features", (item) => Array.isArray(item) && item.every(isText)))
    return;
  for (const key of OBJECT_FIELDS) if (!optionalField(value, key, isRecord)) return;
  for (const key of TEXT_FIELDS) if (!optionalField(value, key, isText)) return;
  for (const key of FLAG_FIELDS)
    if (!optionalField(value, key, (item) => typeof item === "boolean")) return;
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

export function isAgentHistoryTurn(value: unknown): value is AgentHistoryTurn {
  if (!isRecord(value)) return false;
  if (value.role !== "user" && value.role !== "assistant") return false;
  if (!isText(value.content)) return false;
  if (!optionalField(value, "thoughts", isText)) return false;
  if (!optionalField(value, "tools", Array.isArray)) return false;
  return true;
}
