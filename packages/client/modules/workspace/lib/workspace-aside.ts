import { computed, provide, shallowRef, watch, type Ref } from "vue";
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
