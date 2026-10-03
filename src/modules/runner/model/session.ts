import { computed, reactive } from "vue";
import { useProjects, type ProcessSnapshot } from "../../project/index.ts";
import { openProject, startProject, stopProject } from "../api/client.ts";

const state = reactive({
  error: "",
});

let connected = false;

export function useRunner() {
  const catalog = useProjects();
  const error = computed(() => state.error);

  function applyStatus(snapshot: ProcessSnapshot): void {
    catalog.applyRuntime(snapshot);
  }

  function connect(): void {
    if (connected) return;
    connected = true;
    const source = new EventSource("/api/events");
    source.addEventListener("launcher-show", () =>
      window.dispatchEvent(new Event("projector:show")),
    );
    source.addEventListener("status", (event) => {
      applyStatus(JSON.parse((event as MessageEvent).data) as ProcessSnapshot);
    });
    source.addEventListener("terminal-started", (event) => {
      window.dispatchEvent(
        new CustomEvent("projector:terminal-started", {
          detail: JSON.parse((event as MessageEvent).data),
        }),
      );
    });
  }

  async function start(id: string, commandId?: string, mode?: "server" | "window"): Promise<void> {
    state.error = "";
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

  return { error, connect, start, stop, open };
}
