import { onBeforeUnmount, watch, type Ref } from "vue";
import { parseDockLayout, serializeDockLayout, type DockLayout } from "../../dock/index.ts";
import type { TabParams } from "../../workspace-api/index.ts";
import type { OpenFile, OpenFileOptions } from "../open-file.ts";
import { useSessionSnapshot } from "../../../common/utilities/session-snapshot.ts";
import { workspaceSessionSchema, type WorkspaceSession } from "../session.ts";
import type { SidebarSection } from "../ui/SidebarTabs.vue";

export interface WorkspaceSessionContext {
  projectId: () => string;
  /** Whether tabs and layout survive a reload (profile feature). */
  persist: boolean;
  initialLayout: () => DockLayout;
  tabs: Ref<OpenFile[]>;
  layout: Ref<DockLayout>;
  restoringSession: Ref<boolean>;
  activeKey: Ref<string>;
  section: Ref<SidebarSection>;
  treeWidth: Ref<number | undefined>;
  sidebarHidden: Ref<boolean>;
  /** Добавляет вкладку зарегистрированного типа без выбора; `undefined` — тип неизвестен профилю. */
  ensureTab: (id: string, params?: TabParams) => string | undefined;
  openFile: (
    path: string,
    line?: number,
    column?: number,
    staged?: boolean,
    options?: OpenFileOptions,
  ) => Promise<number | undefined>;
  openCommitFile: (hash: string, path: string, preview?: boolean) => Promise<number | undefined>;
  fileGeneration: () => number;
  resetFiles: () => void;
  resetGit: () => void;
  reloadGit: () => void;
}

/** Сохраняет и восстанавливает вкладки, раскладку и размеры панелей проекта; сбрасывает всё при смене проекта. */
export function useWorkspaceSession(ctx: WorkspaceSessionContext) {
  const session = useSessionSnapshot(
    () => `projector:workspace:v1:${ctx.projectId()}`,
    (): WorkspaceSession => ({
      tabs: ctx.tabs.value
        .filter((tab) => !tab.localFile)
        .map((tab) => ({
          key: tab.key,
          path: tab.path,
          virtual: tab.virtual,
          params: tab.params,
          commit: tab.commit,
          external: tab.external,
          staged: tab.staged,
          markdownMode: tab.markdownMode,
        })),
      activeKey: ctx.activeKey.value,
      section: ctx.section.value,
      treeWidth: ctx.treeWidth.value,
      sidebarHidden: ctx.sidebarHidden.value,
      layout: serializeDockLayout(ctx.layout.value),
    }),
    workspaceSessionSchema,
    () => ctx.persist && !ctx.restoringSession.value,
  );
  let sessionGeneration = 0;
  async function restoreSession(saved: WorkspaceSession | undefined, generation: number) {
    try {
      for (const tab of saved?.tabs ?? []) {
        if (generation !== sessionGeneration) return;
        if (tab.virtual) {
          // A kind the profile does not know (older session, other source) is dropped.
          // Sessions before params kept a commit overview as `commit`.
          ctx.ensureTab(tab.virtual, tab.params ?? (tab.commit ? { hash: tab.commit } : undefined));
          continue;
        }
        const completed = tab.commit
          ? await ctx.openCommitFile(tab.commit, tab.path, false)
          : await ctx.openFile(tab.path, undefined, undefined, tab.staged, {
              external: tab.external,
              preview: false,
            });
        // A project switch or a user opening another file takes precedence over restoration.
        if (
          generation !== sessionGeneration ||
          completed === undefined ||
          completed !== ctx.fileGeneration()
        )
          return;
        const file = ctx.tabs.value.find((file) => file.key === tab.key);
        if (file) file.markdownMode = tab.markdownMode;
      }
      // Sessions saved before layouts existed only know the active tab.
      if (
        generation === sessionGeneration &&
        !parseDockLayout(saved?.layout) &&
        ctx.tabs.value.some((tab) => tab.key === saved?.activeKey)
      )
        ctx.activeKey.value = saved!.activeKey;
    } finally {
      if (generation === sessionGeneration) ctx.restoringSession.value = false;
    }
  }

  watch(
    () => ctx.projectId(),
    () => {
      const saved = ctx.persist ? session.read() : undefined;
      const generation = ++sessionGeneration;
      ctx.restoringSession.value = true;
      ctx.resetFiles();
      ctx.resetGit();
      ctx.layout.value = parseDockLayout(saved?.layout) ?? ctx.initialLayout();
      ctx.section.value = saved?.section === "project" ? "files" : (saved?.section ?? "files");
      ctx.treeWidth.value = saved?.treeWidth;
      ctx.sidebarHidden.value = !!saved?.sidebarHidden;
      ctx.reloadGit();
      void restoreSession(saved, generation);
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    ++sessionGeneration;
  });
}
