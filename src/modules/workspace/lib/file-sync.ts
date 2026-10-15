import { onBeforeUnmount, onMounted, watch, type Ref } from "vue";
import {
  subscribeWorkspace,
  watchWorkspace,
  workspaceRequest,
  workspaceWatchable,
} from "../../workspace-api/index.ts";
import type { FileContent } from "../../../../core/modules/workspace/index.ts";
import type { OpenFile } from "../open-file.ts";

export interface FileSyncContext {
  projectId: () => string;
  tabs: Ref<OpenFile[]>;
  isDirty: (file: OpenFile) => boolean;
  /** Файл на диске изменился: Git и маркеры строк устарели. */
  changed: () => void;
}

/** Вкладка показывает рабочую копию файла проекта, которую можно перечитать с диска. */
const synced = (file: OpenFile) =>
  !file.virtual &&
  !file.external &&
  !file.commit &&
  !file.localFile &&
  !file.binary &&
  !file.image &&
  !file.archive &&
  file.staged !== true;

/**
 * Согласует открытые файлы с диском: сервер следит за их папками и присылает `file-changed`.
 * Вкладка без правок обновляется молча; при несохранённых правках появляется конфликт,
 * который решает пользователь (загрузить с диска или оставить свою версию).
 */
export function useFileSync(ctx: FileSyncContext) {
  const watchable = () => workspaceWatchable(ctx.projectId());
  const trackable = () => ctx.tabs.value.filter(synced);

  /** Сверяет вкладку с диском. */
  async function check(file: OpenFile) {
    if (!synced(file) || file.saving) return;
    const projectId = ctx.projectId();
    let disk: string;
    try {
      disk = (await workspaceRequest<FileContent>(projectId, "file", { path: file.path })).content;
    } catch (error) {
      if (projectId !== ctx.projectId() || !ctx.tabs.value.includes(file)) return;
      file.conflict = { error: error instanceof Error ? error.message : "Файл недоступен" };
      return;
    }
    if (projectId !== ctx.projectId() || !ctx.tabs.value.includes(file) || file.saving) return;
    if (disk === file.content) {
      file.conflict = undefined;
      return;
    }
    if (!ctx.isDirty(file) || file.draft === disk) {
      file.content = disk;
      file.draft = undefined;
      file.conflict = undefined;
      file.saveError = "";
      ctx.changed();
    } else file.conflict = { disk };
  }
  const checkPath = (path: string) =>
    Promise.all(
      trackable()
        .filter((file) => file.path === path)
        .map(check),
    );

  /** Отбрасывает правки и берёт версию с диска. */
  async function reloadFromDisk(file: OpenFile) {
    file.draft = undefined;
    file.conflict = undefined;
    file.saveError = "";
    await check(file);
  }
  /** Оставляет свои правки: версия на диске становится «исходной», и сохранение перезапишет её. */
  function keepMine(file: OpenFile) {
    const disk = file.conflict?.disk;
    if (disk === undefined) return;
    file.content = disk;
    file.conflict = undefined;
    file.saveError = "";
  }

  let sentKey = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  function publish(force = false) {
    if (!watchable()) return;
    const paths = [...new Set(trackable().map((file) => file.path))].sort();
    const key = `${ctx.projectId()}\0${paths.join("\0")}`;
    if (key === sentKey && !force) return;
    sentKey = key;
    void watchWorkspace(ctx.projectId(), { paths }).then((ok) => {
      if (!ok) sentKey = "";
    });
  }
  watch(
    () => [ctx.projectId(), ...trackable().map((file) => file.path)].join("\0"),
    () => {
      clearTimeout(timer);
      timer = setTimeout(() => publish(), 150);
    },
    { flush: "post" },
  );

  function onReconnect() {
    publish(true);
    for (const file of trackable()) void check(file);
  }
  let stopSubscription: (() => void) | undefined;
  onMounted(() => {
    stopSubscription = watch(
      ctx.projectId,
      (projectId, previous, cleanup) => {
        if (previous) void watchWorkspace(previous, { paths: [] });
        const unsubscribe = subscribeWorkspace(projectId, {
          file: (path) => {
            void checkPath(path);
          },
          reconnect: onReconnect,
        });
        cleanup(unsubscribe);
        publish(true);
      },
      { immediate: true },
    );
  });
  onBeforeUnmount(() => {
    clearTimeout(timer);
    stopSubscription?.();
    void watchWorkspace(ctx.projectId(), { paths: [] }, true);
  });
  return { check, reloadFromDisk, keepMine };
}
