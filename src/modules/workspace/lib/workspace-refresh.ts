import type { Ref } from "vue";
import { watch } from "vue";
import { relocatedPath } from "../../../../core/modules/workspace/index.ts";
import { replacePanel, type DockLayout } from "../../dock/index.ts";
import { refreshWorkspace, type WorkspaceCapabilities } from "../../workspace-api/index.ts";
import { filesExcludeRevision } from "../modules/tree/index.ts";
import type { OpenFile } from "../open-file.ts";
import type { useOpenFiles } from "./open-files.ts";

export interface WorkspaceRefreshContext {
  projectId: () => string;
  capabilities: Readonly<WorkspaceCapabilities>;
  tabs: Ref<OpenFile[]>;
  layout: Ref<DockLayout>;
  files: ReturnType<typeof useOpenFiles>;
  active: () => OpenFile | undefined;
  activeKey: () => string | undefined;
  revision: Ref<number>;
  section: Ref<string>;
  searchPanel: () => { search(): Promise<void> | void; refreshSearch(): void } | undefined;
  loadGit: () => Promise<void>;
}

/** Re-reading the workspace after the source changed, and keeping open tabs valid after a move. */
export function useWorkspaceRefresh(ctx: WorkspaceRefreshContext) {
  watch(filesExcludeRevision, () => {
    ctx.revision.value++;
  });
  const { tabs, files } = ctx;
  const { openFile, openBrowserFile, closeTab, selectTab } = files;
  async function refresh() {
    await refreshWorkspace(ctx.projectId());
    ctx.revision.value++;
    await ctx.loadGit();
    if (ctx.section.value === "search") await ctx.searchPanel()?.search();
    if (!ctx.capabilities.write) {
      const selected = ctx.activeKey();
      for (const tab of [...tabs.value])
        if (!tab.virtual && !tab.commit && !tab.localFile)
          await openFile(tab.path, tab.line, tab.column, undefined, {
            reload: true,
            preview: !!tab.preview,
          });
      if (selected && tabs.value.some((tab) => tab.key === selected)) selectTab(selected);
      return;
    }
    const current = ctx.active();
    if (!current || current.virtual || current.commit) return;
    if (current.localFile) void openBrowserFile(current.localFile, true);
    else
      void openFile(current.path, current.line, current.column, current.staged, {
        reload: true,
        external: !!current.external,
      });
  }
  function entryMoved(source: string, destination: string) {
    files.invalidate();
    for (const tab of [...tabs.value]) {
      if (tab.virtual || tab.commit) continue;
      const path = relocatedPath(tab.path, source, destination);
      if (path === tab.path) continue;
      if (tab.staged !== undefined) {
        closeTab(tab.key);
        continue;
      }
      const key = `${path}:file`;
      ctx.layout.value = replacePanel(ctx.layout.value, tab.key, key);
      tab.path = path;
      tab.key = key;
    }
    ctx.revision.value++;
    void ctx.loadGit();
    ctx.searchPanel()?.refreshSearch();
  }
  return { refresh, entryMoved };
}
