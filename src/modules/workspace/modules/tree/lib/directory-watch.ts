import { onBeforeUnmount, onMounted } from "vue";
import { notify } from "../../../../../common/utilities/notice.ts";
import {
  subscribeWorkspace,
  watchWorkspace,
  workspaceWatchable,
} from "../../../../workspace-api/index.ts";

/** Раскрытые папки всех деревьев страницы: сколько списков показывает каждую. */
const shown = new Map<string, Map<string, number>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function publish(projectId: string) {
  clearTimeout(timers.get(projectId));
  timers.set(
    projectId,
    setTimeout(() => {
      timers.delete(projectId);
      void watchWorkspace(projectId, { directories: [...(shown.get(projectId)?.keys() ?? [])] });
    }, 150),
  );
}
function track(projectId: string, path: string) {
  const folders = shown.get(projectId) ?? new Map<string, number>();
  folders.set(path, (folders.get(path) ?? 0) + 1);
  shown.set(projectId, folders);
  publish(projectId);
  return () => {
    const count = (folders.get(path) ?? 1) - 1;
    if (count > 0) folders.set(path, count);
    else folders.delete(path);
    if (!folders.size) shown.delete(projectId);
    publish(projectId);
  };
}

let warned = false;
const MIN_FOCUS_GAP_MS = 5000;

/**
 * Список папки дерева следит за ней на сервере и перечитывается, когда в ней что-то создали,
 * удалили или переименовали снаружи. Страховка от потерянных событий — возврат фокуса в окно
 * и переподключение потока событий.
 */
export function useDirectoryWatch(props: { projectId: string; path: string }, reload: () => void) {
  let release: (() => void) | undefined;
  let unsubscribe: (() => void) | undefined;
  let lastFocus = 0;
  function onChanged(directory: string) {
    if (directory === props.path) reload();
  }
  function onFocus() {
    if (Date.now() - lastFocus < MIN_FOCUS_GAP_MS) return;
    lastFocus = Date.now();
    reload();
  }
  function onReconnect() {
    publish(props.projectId);
    reload();
  }
  function onFailure(message: string) {
    if (warned) return;
    warned = true;
    notify(null, message, "error", 10000);
  }
  onMounted(() => {
    if (workspaceWatchable(props.projectId)) {
      release = track(props.projectId, props.path);
      unsubscribe = subscribeWorkspace(props.projectId, {
        directory: onChanged,
        reconnect: onReconnect,
        error: onFailure,
      });
    }
    window.addEventListener("focus", onFocus);
  });
  onBeforeUnmount(() => {
    release?.();
    unsubscribe?.();
    window.removeEventListener("focus", onFocus);
  });
}
