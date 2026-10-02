import { computed, reactive } from "vue";
import { useProjects, type LogLine, type ProcessSnapshot } from "../../catalog/index.ts";
import { fetchLogs, openProject, startProject, stopProject } from "../api/client.ts";

const state = reactive({
  logs: {} as Record<string, LogLine[]>,
  error: "",
});

let connected = false;

export function useRunner() {
  const catalog = useProjects();
  const error = computed(() => state.error);

  function logsFor(id: string): LogLine[] {
    return state.logs[id] ?? [];
  }

  function applyStatus(snapshot: ProcessSnapshot): void {
    catalog.applyRuntime(snapshot);
  }

  function appendLog(line: LogLine): void {
    const current = state.logs[line.projectId] ?? [];
    current.push(line);
    if (current.length > 800) current.splice(0, current.length - 800);
    state.logs[line.projectId] = current;
  }

  async function hydrate(id: string): Promise<void> {
    const data = await fetchLogs(id);
    state.logs[id] = data.logs;
  }

  function connect(): void {
    if (connected) return;
    connected = true;
    const source = new EventSource("/api/events");
    source.addEventListener("launcher-show", () => window.dispatchEvent(new Event("projector:show")));
    source.addEventListener("status", (event) => {
      applyStatus(JSON.parse((event as MessageEvent).data) as ProcessSnapshot);
    });
    source.addEventListener("log", (event) => {
      appendLog(JSON.parse((event as MessageEvent).data) as LogLine);
    });
  }

  async function start(id: string, commandId?: string, mode?: "server" | "window"): Promise<void> {
    state.error = "";
    state.logs[id] = [];
    try {
      const data = await startProject(id, commandId, mode);
      applyStatus(data.runtime);
    } catch (err) {
      state.error = err instanceof Error ? err.message : "Не удалось запустить";
    }
  }

  async function stop(id: string): Promise<void> {
    state.error = "";
    try {
      const data = await stopProject(id);
      applyStatus(data.runtime);
    } catch (err) {
      state.error = err instanceof Error ? err.message : "Не удалось остановить";
    }
  }

  async function open(id: string, mode: "server" | "window"): Promise<void> {
    state.error = "";
    try {
      await openProject(id, mode);
    } catch (err) {
      state.error = err instanceof Error ? err.message : "Не удалось открыть";
    }
  }

  return { error, logsFor, connect, hydrate, start, stop, open };
}
