import {
  computed,
  getCurrentInstance,
  inject,
  provide,
  shallowRef,
  watch,
  type InjectionKey,
  type Ref,
} from "vue";
import { dockGroups, type DockLayout } from "../../dock/index.ts";
import { asideTargetKey } from "./aside-target.ts";
import type {
  WorkspaceCapabilities,
  WorkspaceProfile,
  SidebarRegistry,
  SidebarType,
} from "../../workspace-api/index.ts";
import { useWorkspaceAside } from "./aside-panels.ts";
import { registerRightPanelCommands, type RegisterWorkspaceCommand } from "./right-panel.ts";
import { asideSections, type SidebarViews } from "./sidebar-views.ts";
import TerminalsAside from "../ui/TerminalsAside.vue";
import { AgentTrajectoryAside } from "../../agent-trajectory/index.ts";

export interface WorkspaceAsidePanelContext {
  profile: WorkspaceProfile;
  capabilities: WorkspaceCapabilities;
  mobile: Ref<boolean>;
  /** The «Правая панель» setting with the project override applied. */
  enabled: () => boolean;
  /** Project override of the setting; the session stores it. */
  override: Ref<boolean | undefined>;
  layout: Ref<DockLayout>;
  register: RegisterWorkspaceCommand;
  /** Views of the sections the embedding page owns. */
  views?: SidebarViews;
  addedSections?: () => SidebarType[];
  /** Reloads the selected section; the panel ref belongs to the workspace. */
  refresh: (id?: string) => unknown;
}

/** How the trajectory commands show their section without knowing the workspace internals. */
export interface TrajectoryPanelOpener {
  show(id: string): void;
  mobile(): boolean;
}

export const trajectoryPanelKey: InjectionKey<TrajectoryPanelOpener> = Symbol(
  "projector.trajectory-panel",
);

/** Read by editor commands; provided by the mounted workspace. */
export function useTrajectoryPanelOpener(): TrajectoryPanelOpener | undefined {
  return getCurrentInstance() ? inject(trajectoryPanelKey, undefined) : undefined;
}

/**
 * The right rail behind a setting. Its section is «Терминалы»: the terminal group is teleported
 * there, so the dock keeps the editor and other blocks. Tabs can be dragged between the dock and
 * the rail panel like between any other dock groups.
 */
export function useWorkspaceAsidePanel(ctx: WorkspaceAsidePanelContext) {
  /** Element the dock teleports the terminal group into; registered by the rail section. */
  const asideTarget = shallowRef<HTMLElement>();
  provide(asideTargetKey, asideTarget);
  const registry: SidebarRegistry = asideSections(ctx.profile, ctx.capabilities);
  const views = computed<SidebarViews>(() => ({
    terminals: {
      icon: "terminal",
      component: TerminalsAside,
      props: () => ({}),
      refreshGutter: true,
    },
    trajectory: {
      icon: "list-tree",
      component: AgentTrajectoryAside,
      props: (host) => ({
        onOpenFile: (path: string) => host.openFile(path),
      }),
    },
    ...ctx.views,
  }));
  const state = useWorkspaceAside({
    registry,
    addedSections: ctx.addedSections,
    mobile: ctx.mobile,
    enabled: ctx.enabled,
    register: ctx.register,
    refresh: ctx.refresh,
  });
  provide(trajectoryPanelKey, {
    show: () => {
      ctx.override.value = true;
      state.section.value = "trajectory";
      state.show();
    },
    mobile: () => ctx.mobile.value,
  });
  registerRightPanelCommands({
    override: ctx.override,
    enabled: ctx.enabled,
    register: ctx.register,
  });
  /** A new terminal arrives in the folded rail: unfold it so the session is not lost. */
  const terminalCount = computed(
    () => dockGroups(ctx.layout.value).find((group) => group.panel)?.panels.length ?? 0,
  );
  watch(terminalCount, (count, previous) => {
    if (state.visible.value && count > (previous ?? 0)) {
      if (registry.has("terminals")) state.section.value = "terminals";
      state.show();
    }
  });
  /** A folded bottom panel has no compact switcher, so closing it removes the whole row. */
  const shown = computed(() => state.visible.value && !(state.middle.value && state.hidden.value));
  return { ...state, shown, asideTarget, registry, views };
}
