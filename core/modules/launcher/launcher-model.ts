import type { LaunchActionId, LaunchItem, LauncherClient } from "./launcher.ts";

export interface LauncherState {
  query: string;
  items: LaunchItem[];
  selected: number;
  loading: boolean;
  busy: boolean;
  error: string;
  warning: string;
  notice: string;
  /** Маршрут воркспейса последнего действия `open`; пусто для остальных. */
  route: string;
}

/** UI-independent search, selection and launch state shared by GTK and Vue. */
export function createLauncherModel(client: Pick<LauncherClient, "search" | "launch">) {
  const state: LauncherState = {
    query: "",
    items: [],
    selected: 0,
    loading: true,
    busy: false,
    error: "",
    warning: "",
    notice: "",
    route: "",
  };
  const listeners = new Set<(state: LauncherState) => void>();
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let disposed = false;
  const emit = () => {
    if (!disposed) for (const listener of listeners) listener({ ...state });
  };
  const invalidate = () => {
    generation++;
    clearTimeout(timer);
    controller?.abort();
  };

  async function search(background = false) {
    invalidate();
    const current = generation;
    controller = new AbortController();
    if (!background) state.loading = true;
    state.error = "";
    emit();
    try {
      const data = await client.search(
        state.query,
        AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      );
      if (disposed || current !== generation) return;
      state.items = data.items;
      state.warning = data.warning ?? "";
      state.selected = 0;
    } catch (error) {
      if (!disposed && current === generation) {
        state.items = [];
        state.selected = 0;
        state.warning = "";
        state.error = error instanceof Error ? error.message : "Не удалось выполнить поиск";
      }
    } finally {
      if (!disposed && current === generation) {
        state.loading = false;
        emit();
      }
    }
  }

  return {
    get state() {
      return state;
    },
    subscribe(listener: (state: LauncherState) => void) {
      listeners.add(listener);
      listener({ ...state });
      return () => {
        listeners.delete(listener);
      };
    },
    search,
    setQuery(query: string) {
      state.query = query;
      state.notice = "";
      invalidate();
      state.loading = true;
      emit();
      timer = setTimeout(() => {
        void search();
      }, 80);
    },
    select(index: number) {
      state.selected = Math.max(0, Math.min(state.items.length - 1, index));
      emit();
    },
    move(delta: number) {
      this.select(state.selected + delta);
    },
    /** Действие по умолчанию — первое у элемента; `inline` оставляет переход клиенту. */
    async launch(
      item = state.items[state.selected],
      action?: LaunchActionId,
      inline = false,
    ): Promise<boolean> {
      if (!item || state.busy || state.loading || disposed) return false;
      state.busy = true;
      state.error = "";
      state.notice = "";
      state.route = "";
      emit();
      try {
        const result = await client.launch(item.id, action ?? item.actions?.[0]?.id, inline);
        if (disposed) return false;
        state.route = result?.route ?? "";
        state.notice = `${item.name} — ${(action ?? item.actions?.[0]?.id) === "open" ? "открыто" : "запущено"}`;
        return true;
      } catch (error) {
        state.error = error instanceof Error ? error.message : "Не удалось запустить";
        return false;
      } finally {
        state.busy = false;
        emit();
      }
    },
    reportError(error: unknown) {
      state.error = error instanceof Error ? error.message : String(error);
      emit();
    },
    dispose() {
      disposed = true;
      invalidate();
      listeners.clear();
    },
  };
}
