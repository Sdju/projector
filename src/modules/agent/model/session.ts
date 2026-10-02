import { computed, reactive } from "vue";
import { useProjects, type Project } from "../../catalog/index.ts";
import { streamAgent } from "../api/client.ts";
import type { AgentHistoryTurn, AgentTurn, AgentCommandRequest } from "./types.ts";

const createState = () =>
  reactive({
    turns: [] as AgentTurn[],
    draft: "",
    busy: false,
    error: "",
    phase: "",
    abort: undefined as AbortController | undefined,
  });

function summarize(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.slice(0, 8000);
  try {
    return JSON.stringify(value, null, 2).slice(0, 8000);
  } catch {
    return "";
  }
}

const sessions = new Map<string, ReturnType<typeof createState>>();
const loads = new Map<string, Promise<void>>();
const saves = new Map<string, Promise<void>>();
export function useAgent(
  projectId = "",
  commands?: (request: AgentCommandRequest) => Promise<unknown>,
) {
  if (!sessions.has(projectId)) sessions.set(projectId, createState());
  const state = sessions.get(projectId)!;

  const historyUrl = `/api/agent/history/${encodeURIComponent(projectId || "catalog")}`;
  if (!loads.has(projectId))
    loads.set(
      projectId,
      fetch(historyUrl)
        .then(async (response) => {
          if (!response.ok) throw new Error("Не удалось загрузить историю чата");
          const data = await response.json();
          state.turns = data.turns;
          for (const turn of state.turns)
            for (const chip of turn.tools) {
              if (chip.status === "running") {
                chip.status = "error";
                chip.detail = "Выполнение прервано";
              }
            }
        })
        .catch((error) => {
          state.error = error.message;
        }),
    );
  const ready = loads.get(projectId)!;
  function persist() {
    const body = JSON.stringify({ turns: state.turns.slice(-200) });
    const saving = (saves.get(projectId) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const response = await fetch(historyUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body,
        });
        if (!response.ok) throw new Error("Не удалось сохранить историю чата");
      });
    saves.set(projectId, saving);
    void saving.catch((error) => {
      state.error = error.message;
    });
  }
  const catalog = useProjects();
  const turns = computed(() => state.turns);
  const draft = computed({
    get: () => state.draft,
    set: (value: string) => {
      state.draft = value;
    },
  });
  const busy = computed(() => state.busy);
  const error = computed({
    get: () => state.error,
    set: (value: string) => {
      state.error = value;
    },
  });
  const phase = computed(() => state.phase);

  function history(): AgentHistoryTurn[] {
    return state.turns
      .filter((item) => item.text.trim())
      .map((item) => ({ role: item.role, content: item.text }));
  }

  async function send(text?: string): Promise<void> {
    await ready;
    const message = (text ?? state.draft).trim();
    if (!message || state.busy) return;
    state.draft = "";
    state.error = "";
    state.busy = true;
    state.phase = "думает";
    const previousHistory = history();
    state.abort = new AbortController();
    const userTurn: AgentTurn = {
      id: crypto.randomUUID(),
      role: "user",
      text: message,
      tools: [],
    };
    const assistant = reactive<AgentTurn>({
      id: crypto.randomUUID(),
      role: "assistant",
      text: "",
      tools: [],
    });
    state.turns.push(userTurn, assistant);

    try {
      await streamAgent(
        message,
        previousHistory,
        (event) => {
          if (event.event === "status") {
            state.phase = event.data.model
              ? `${event.data.provider ?? "qwen"} · ${event.data.model}`
              : "думает";
          }
          if (event.event === "text") assistant.text += event.data.text;
          if (event.event === "tool") {
            if (assistant.text.trim() && !assistant.text.endsWith("\n\n")) assistant.text += "\n\n";
            assistant.tools.push({
              id: event.data.id,
              name: event.data.name,
              status: "running",
              detail: summarize(event.data.input),
            });
          }
          if (event.event === "tool-result") {
            const chip = assistant.tools.find((item) => item.id === event.data.id);
            if (chip) {
              chip.status = event.data.error ? "error" : "done";
              chip.detail = event.data.error || summarize(event.data.output);
            }
          }
          if (event.event === "project") catalog.ingest(event.data as Project);
          if (event.event === "error") state.error = event.data.error;
        },
        state.abort.signal,
        { projectId: projectId || undefined, commands },
      );
    } catch (err) {
      if (!state.abort?.signal.aborted)
        state.error = err instanceof Error ? err.message : "Агент не ответил";
    } finally {
      state.abort?.abort();
      for (const chip of assistant.tools)
        if (chip.status === "running") {
          chip.status = "error";
          chip.detail = "Выполнение прервано";
        }
      state.busy = false;
      state.phase = "";
      persist();
    }
  }

  async function clear(): Promise<void> {
    await ready;
    if (state.busy) return;
    state.turns = [];
    state.error = "";
    state.phase = "";
    state.draft = "";
    persist();
  }

  const stop = () => state.abort?.abort();
  return { turns, draft, busy, error, phase, send, clear, stop };
}
