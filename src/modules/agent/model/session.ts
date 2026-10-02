import { computed, reactive } from "vue";
import { useProjects, type Project } from "../../catalog/index.ts";
import { streamAgent } from "../api/client.ts";
import type { AgentHistoryTurn, AgentTurn } from "./types.ts";

const state = reactive({
  turns: [] as AgentTurn[],
  draft: "",
  busy: false,
  error: "",
  phase: "",
});

function summarize(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.slice(0, 120);
  try {
    return JSON.stringify(value).slice(0, 140);
  } catch {
    return "";
  }
}

export function useAgent() {
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
    const message = (text ?? state.draft).trim();
    if (!message || state.busy) return;
    state.draft = "";
    state.error = "";
    state.busy = true;
    state.phase = "думает";
    const userTurn: AgentTurn = {
      id: crypto.randomUUID(),
      role: "user",
      text: message,
      tools: [],
    };
    const assistant: AgentTurn = {
      id: crypto.randomUUID(),
      role: "assistant",
      text: "",
      tools: [],
    };
    state.turns.push(userTurn, assistant);

    try {
      await streamAgent(message, history().slice(0, -1), (event) => {
        if (event.event === "status") {
          state.phase = event.data.model
            ? `${event.data.provider ?? "qwen"} · ${event.data.model}`
            : "думает";
        }
        if (event.event === "text") assistant.text += event.data.text;
        if (event.event === "tool") {
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
      });
    } catch (err) {
      state.error = err instanceof Error ? err.message : "Агент не ответил";
    } finally {
      state.busy = false;
      state.phase = "";
    }
  }

  function clear(): void {
    state.turns = [];
    state.error = "";
    state.phase = "";
    state.draft = "";
  }

  return { turns, draft, busy, error, phase, send, clear };
}
