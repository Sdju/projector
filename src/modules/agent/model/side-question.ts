import { reactive, type Ref } from "vue";
import { fetchLiveRuns } from "../api/client.ts";
import { streamSide } from "../api/side.ts";
import { btwQuestion } from "../lib/side-command.ts";
import { shownPlan } from "../lib/plan.ts";
import { chatHistory } from "./chat-state.ts";
import type {
  AgentChatStatus,
  AgentCommandRequest,
  AgentHistoryTurn,
  AgentPermission,
  AgentQuestionRequest,
  AgentSecretRequest,
  AgentSelection,
  AgentSideExchange,
  AgentSideMeta,
  AgentTurn,
  QueuedMessage,
} from "./types.ts";

export interface SideCheck {
  id: string;
  name: string;
  status: "running" | "done" | "error";
  detail?: string;
}

export interface SideQuestionOptions {
  chat: string;
  projectId: string;
  backend: string;
  turns: Ref<AgentTurn[]>;
  busy: Ref<boolean>;
  phase: Ref<string>;
  lastEventAt: Ref<number>;
  permissions: Ref<AgentPermission[]>;
  questions: Ref<AgentQuestionRequest[]>;
  secrets: Ref<AgentSecretRequest[]>;
  queue: Ref<QueuedMessage[]>;
  selection: Ref<AgentSelection>;
  commands?: (request: AgentCommandRequest) => Promise<unknown>;
}

const QUIET_MS = 30_000;

/** The history the side model sees: completed turns, with the running answer's text left out. */
export function sideHistory(turns: AgentTurn[], busy: boolean): AgentHistoryTurn[] {
  const last = turns.at(-1);
  const completed = busy && last?.role === "assistant" ? turns.slice(0, -1) : turns;
  const history = chatHistory(completed, true);
  if (busy && last?.role === "assistant") {
    const tools = last.tools
      .filter((tool) => !tool.parent && tool.status !== "running")
      .map((tool) => ({
        id: tool.id,
        name: tool.name,
        ...(tool.input ? { input: tool.input } : {}),
        output: tool.detail,
        ...(tool.status === "error" ? { failed: true } : {}),
      }));
    if (tools.length) history.push({ role: "assistant", content: "", tools });
  }
  // A side question does not need the whole chat; start at a user turn so no tool call is orphaned.
  let start = Math.max(0, history.length - 60);
  while (start < history.length && history[start].role !== "user") start++;
  return history.slice(start);
}

/**
 * The side panel of one chat. Its exchanges live only in memory: no chat history, no run record,
 * no session. The server answers each question as a read-only Projector turn.
 */
export function useSideQuestion(options: SideQuestionOptions) {
  const state = reactive({
    open: false,
    question: "",
    currentQuestion: "",
    current: "",
    busy: false,
    error: "",
    meta: { mode: "projector" } as AgentSideMeta,
    checks: [] as SideCheck[],
    exchanges: [] as AgentSideExchange[],
  });
  let controller: AbortController | undefined;

  function openPanel() {
    state.open = true;
  }
  function close() {
    state.open = false;
  }
  function toggle() {
    state.open = !state.open;
  }
  function clear() {
    controller?.abort();
    state.exchanges = [];
    state.current = "";
    state.currentQuestion = "";
    state.question = "";
    state.error = "";
    state.checks = [];
  }
  function reset() {
    clear();
    state.open = false;
    state.busy = false;
    state.meta = { mode: "projector" };
  }
  function stop() {
    controller?.abort();
  }

  function checksOf(turns: AgentTurn[]) {
    const last = turns.at(-1);
    return last?.role === "assistant"
      ? last.tools
          .filter((tool) => tool.status === "running")
          .map((tool) => ({
            name: tool.name,
            ...(tool.input ? { input: tool.input.slice(0, 500) } : {}),
            ...(tool.startedAt ? { startedAt: tool.startedAt } : {}),
          }))
      : [];
  }

  /** The read-only state `ide.agent.chat.status` gives the side agent. */
  async function status(): Promise<AgentChatStatus> {
    const turns = options.turns.value;
    const last = turns.findLast((turn) => turn.role === "assistant");
    const startedAt = last?.at;
    const now = Date.now();
    const lastEventAt = options.lastEventAt.value || undefined;
    const currentTools = checksOf(turns).map((tool) => ({
      name: tool.name,
      ...(tool.input ? { input: tool.input } : {}),
      ...(tool.startedAt ? { startedAt: tool.startedAt } : {}),
      ...(tool.startedAt ? { elapsedMs: now - tool.startedAt } : {}),
    }));
    const pending = {
      permissions: options.permissions.value.map((item) => ({
        tool: item.tool,
        title: item.title,
      })),
      questions: options.questions.value.map((item) => ({
        ...(item.title ? { title: item.title } : {}),
        count: item.questions.length,
      })),
      secrets: options.secrets.value.map((item) => ({ label: item.label })),
    };
    let checked = true;
    const live = await fetchLiveRuns()
      .then((runs) => runs.find((run) => run.chat === options.chat))
      .catch(() => {
        checked = false;
        return undefined;
      });
    const waiting =
      pending.permissions.length > 0 || pending.questions.length > 0 || pending.secrets.length > 0;
    const healthy = !options.busy.value
      ? "idle"
      : waiting
        ? "waiting-user"
        : options.phase.value.includes("фонов")
          ? "waiting-background"
          : currentTools.length
            ? "running-tool"
            : !checked
              ? "quiet"
              : !live
                ? "broken"
                : lastEventAt && now - lastEventAt >= QUIET_MS
                  ? "quiet"
                  : "active";
    return {
      chat: options.chat,
      backend: options.backend,
      busy: options.busy.value,
      phase: options.phase.value,
      ...(startedAt ? { startedAt, elapsedMs: now - startedAt } : {}),
      ...(lastEventAt ? { lastEventAt, sinceLastEventMs: now - lastEventAt } : {}),
      currentTools,
      pending,
      queue: {
        count: options.queue.value.length,
        texts: options.queue.value.slice(0, 5).map((item) => item.text.slice(0, 200)),
      },
      live: live
        ? {
            found: true,
            checked: true,
            run: live.id,
            ...(live.startedAt ? { startedAt: live.startedAt } : {}),
          }
        : { found: false, checked },
      health: healthy,
      ...(!options.busy.value && last?.text.trim()
        ? { lastAssistantText: last.text.trim().slice(0, 1_200) }
        : {}),
      ...(last?.session?.id ? { session: last.session.id } : {}),
      ...(turns.findLast((turn) => turn.context)?.context
        ? { context: turns.findLast((turn) => turn.context)!.context }
        : {}),
    };
  }

  /**
   * Asks a question. An empty string only opens the panel; a busy side panel refuses a second
   * question instead of queueing it. The answer is not appended to the chat.
   */
  async function ask(text = state.question): Promise<string> {
    const question = text.trim();
    if (!question) {
      openPanel();
      return "";
    }
    if (state.busy) throw new Error("Дождитесь ответа на прошлый вопрос в сторону");
    state.open = true;
    state.question = "";
    state.currentQuestion = question;
    state.current = "";
    state.error = "";
    state.checks = [];
    state.meta = { mode: "projector" };
    state.busy = true;
    controller = new AbortController();
    let failure = "";
    try {
      await streamSide(
        question,
        sideHistory(options.turns.value, options.busy.value),
        {
          projectId: options.projectId,
          chat: options.chat,
          backend: options.backend,
          // Another agent's model/effort must not leak into the Projector side answer.
          selection: options.backend === "projector" ? options.selection.value : {},
          thread: state.exchanges.slice(-20),
          running: checksOf(options.turns.value),
          plan: shownPlan(options.turns.value).map((item) => ({
            content: item.content,
            status: item.status,
          })),
          commands: options.commands,
          signal: controller.signal,
        },
        (event) => {
          switch (event.event) {
            case "meta":
              state.meta = { ...state.meta, ...event.data };
              return;
            case "status":
              if (event.data.provider || event.data.model)
                state.meta = {
                  ...state.meta,
                  ...(event.data.provider ? { provider: event.data.provider } : {}),
                  ...(event.data.model ? { model: event.data.model } : {}),
                };
              return;
            case "text":
              state.current += event.data.text;
              return;
            case "tool": {
              const known = state.checks.find((item) => item.id === event.data.id);
              if (known) {
                known.name = event.data.name;
                known.status = "running";
              } else
                state.checks.push({
                  id: event.data.id,
                  name: event.data.name,
                  status: "running",
                });
              return;
            }
            case "tool-result": {
              const check = state.checks.find((item) => item.id === event.data.id);
              if (check) {
                check.status = event.data.error ? "error" : "done";
                const detail = event.data.error || event.data.output;
                if (detail !== undefined)
                  check.detail = (
                    typeof detail === "string" ? detail : JSON.stringify(detail)
                  ).slice(0, 2_000);
              }
              return;
            }
            case "done":
              if (event.data.text) state.current = event.data.text;
              return;
            case "error":
              failure = event.data.error;
              return;
            default:
              return;
          }
        },
      );
      if (controller.signal.aborted) return state.current.trim();
      if (failure) throw new Error(failure);
      const answer = state.current.trim();
      if (!answer) throw new Error("Агент не ответил на вопрос в сторону");
      state.exchanges.push({ question, answer });
      state.current = "";
      state.currentQuestion = "";
      state.checks = [];
      return answer;
    } catch (error) {
      if (!controller.signal.aborted) {
        state.error = error instanceof Error ? error.message : "Вопрос в сторону не удался";
        state.question = question;
      }
      throw error;
    } finally {
      state.busy = false;
      controller = undefined;
    }
  }

  /** `/btw` in the main composer: the question, or `undefined` for an ordinary message. */
  function command(text: string): string | undefined {
    return btwQuestion(text);
  }

  return { state, openPanel, close, toggle, clear, reset, stop, ask, status, command };
}

export type SideQuestion = ReturnType<typeof useSideQuestion>;
