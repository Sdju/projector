import type {
  LaunchAction,
  LaunchActionId,
  LaunchDetail,
  LaunchItem,
  LauncherClient,
} from "./launcher.ts";

export interface LauncherState {
  query: string;
  /** Элемент, в который вошли стрелкой вправо; его действия и сбой лежат в `detail`. */
  focus: LaunchItem | null;
  detail: LaunchDetail | null;
  detailLoading: boolean;
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
export function createLauncherModel(
  client: Pick<LauncherClient, "search" | "launch" | "detail"> &
    Partial<Pick<LauncherClient, "subscribe">>,
) {
  const state: LauncherState = {
    query: "",
    focus: null,
    detail: null,
    detailLoading: false,
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
  let detailController: AbortController | undefined;
  const leave = () => {
    detailController?.abort();
    state.focus = null;
    state.detail = null;
    state.detailLoading = false;
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

  let stopEvents: (() => void) | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  /** Quiet reload after a process event: keeps the selected row and the open card. */
  async function refresh() {
    if (disposed || state.busy || state.loading) return;
    const selectedId = state.items[state.selected]?.id;
    const focused = state.focus;
    await search(true);
    const index = state.items.findIndex((entry) => entry.id === selectedId);
    if (index >= 0 && !disposed) {
      state.selected = index;
      emit();
    }
    if (focused && state.focus?.id === focused.id) {
      try {
        const detail = await client.detail(focused.id, AbortSignal.timeout(15000));
        if (!disposed && state.focus?.id === focused.id) {
          state.detail = detail;
          emit();
        }
      } catch {
        /* The card keeps its previous data until the next event. */
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
    refresh,
    /** Follows process events while enabled (the palette is visible). */
    live(enabled: boolean) {
      stopEvents?.();
      stopEvents = undefined;
      clearTimeout(refreshTimer);
      if (!enabled || disposed || !client.subscribe) return;
      stopEvents = client.subscribe(() => {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => void refresh(), 150);
      });
    },
    setQuery(query: string) {
      leave();
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
    /** Вход в элемент: загружает все его действия и последний сбой запуска. */
    async enter(item = state.items[state.selected]): Promise<boolean> {
      if (!item || state.busy || disposed) return false;
      leave();
      state.focus = item;
      state.detail = { actions: item.actions ?? [] };
      state.detailLoading = true;
      state.error = "";
      detailController = new AbortController();
      const current = detailController;
      emit();
      try {
        const detail = await client.detail(
          item.id,
          AbortSignal.any([current.signal, AbortSignal.timeout(15000)]),
        );
        if (disposed || current.signal.aborted) return true;
        state.detail = detail;
      } catch (error) {
        if (!disposed && !current.signal.aborted)
          state.error = error instanceof Error ? error.message : "Не удалось загрузить действия";
      } finally {
        if (!disposed && !current.signal.aborted) {
          state.detailLoading = false;
          emit();
        }
      }
      return true;
    },
    leave() {
      leave();
      emit();
    },
    async launch(
      item = state.items[state.selected],
      action?: LaunchAction | LaunchActionId,
      inline = false,
    ): Promise<boolean> {
      const chosen: LaunchAction | undefined =
        typeof action === "string"
          ? (item?.actions?.find((entry) => entry.id === action) ?? { id: action, title: "" })
          : (action ?? item?.actions?.[0]);
      if (!item || state.busy || state.loading || disposed) return false;
      state.busy = true;
      state.error = "";
      state.notice = "";
      state.route = "";
      emit();
      try {
        const result = await client.launch(item.id, chosen?.id, inline, chosen?.arg);
        if (disposed) return false;
        state.route = result?.route ?? "";
        state.notice = `${item.name} — ${
          chosen?.id === "favorite"
            ? result?.favorite
              ? "добавлено в избранное"
              : "убрано из избранного"
            : chosen?.id === "import"
              ? "клонировано и добавлено"
              : chosen?.id === "open"
                ? "открыто"
                : chosen?.id === "stop"
                  ? "остановлено"
                  : "запущено"
        }`;
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
      detailController?.abort();
      stopEvents?.();
      clearTimeout(refreshTimer);
      invalidate();
      listeners.clear();
    },
  };
}
