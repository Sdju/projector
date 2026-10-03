import type { Ref } from "vue";
import { workspaceRequest } from "../api.ts";
import type { OpenFile } from "../open-file.ts";
import type { FileContent } from "../../../../core/modules/workspace/index.ts";
import type { useOpenFiles } from "./open-files.ts";

export interface GitChangeSyncContext {
  projectId: () => string;
  tabs: Ref<OpenFile[]>;
  active: () => OpenFile | undefined;
  files: ReturnType<typeof useOpenFiles>;
  bumpRevision: () => void;
  refreshSearch: () => void;
}

/** Согласует открытые файлы с операциями Git над индексом: сохранение до записи и обновление вкладок после. */
export function useGitChangeSync(ctx: GitChangeSyncContext) {
  /** Смена HEAD затрагивает любые файлы: сохраняются все открытые. */
  const openTabs = () =>
    ctx.tabs.value.filter((tab) => !tab.virtual && !tab.commit && !tab.external && !tab.localFile);
  async function prepare(action: string, paths: string[]) {
    if (action === "checkout") {
      for (const tab of openTabs())
        if (!(await ctx.files.saveFile(tab))) throw new Error("Не удалось сохранить файл");
      return;
    }
    if (action !== "discard") {
      for (const entry of paths)
        if (!(await ctx.files.prepareEntryChange(entry)))
          throw new Error("Не удалось сохранить файл");
      return;
    }
    if (!(await ctx.files.settle(paths[0]!)))
      throw new Error("Не удалось завершить сохранение файла");
  }
  /** После смены ветки перечитывает вкладки; файлы, которых в ней нет, закрываются. */
  async function reloadAfterCheckout() {
    ctx.files.invalidate();
    const activeKey = ctx.active()?.key;
    for (const tab of openTabs()) {
      await ctx.files.openFile(tab.path, tab.line, tab.column, tab.staged, true);
      if (ctx.files.fileError.value) {
        ctx.files.fileError.value = "";
        ctx.tabs.value = ctx.tabs.value.filter((item) => item !== tab);
      }
    }
    // Reloading selects every tab in turn; return to the one the user was in.
    if (activeKey && ctx.tabs.value.some((tab) => tab.key === activeKey))
      ctx.files.selectTab(activeKey);
    ctx.bumpRevision();
    ctx.refreshSearch();
  }
  async function applied(action: string, paths: string[]) {
    if (action === "checkout") return reloadAfterCheckout();
    const path = paths[0]!;
    ctx.bumpRevision();
    // Drop obsolete comparisons; reload a visible file after discard. Commit diffs are history and stay.
    const current = ctx.active();
    ctx.tabs.value = ctx.tabs.value.filter(
      (tab) =>
        tab.commit ||
        !paths.includes(tab.path) ||
        (tab.original === undefined && action !== "discard"),
    );
    if (current?.path === path && action === "discard") {
      const exists = await workspaceRequest<FileContent>(ctx.projectId(), "file", { path }).then(
        () => true,
        () => false,
      );
      if (exists) await ctx.files.openFile(path);
    }
    ctx.refreshSearch();
  }
  return { prepare, applied };
}
