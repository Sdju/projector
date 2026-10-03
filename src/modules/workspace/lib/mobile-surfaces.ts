import { computed, ref, watch, type Ref } from "vue";
import { useMediaQuery } from "@vueuse/core";
import { commandArgs, type useCommandScope } from "../../../common/utilities/commands.ts";
import type { WorkspaceCapabilities } from "../../workspace-api/index.ts";

export type MobileSurface = "editor" | "files" | "terminal";

/** Mobile navigation is transient; it never touches the saved desktop layout. */
export function useMobileSurfaces(sidebarHidden: Ref<boolean>) {
  const mobile = useMediaQuery(
    "(max-width: 700px), (max-width: 1050px) and (max-height: 500px) and (pointer: coarse)",
  );
  const mobileSurface = ref<MobileSurface>("editor");
  const mobileActionsOpen = ref(false);
  const mobileSidebarOpen = computed({
    get: () => mobileSurface.value === "files",
    set: (open: boolean) => {
      mobileSurface.value = open ? "files" : "editor";
    },
  });
  const sidebarInvisible = computed(() =>
    mobile.value ? !mobileSidebarOpen.value : sidebarHidden.value,
  );
  function showSidebar() {
    if (mobile.value) mobileSidebarOpen.value = true;
    else sidebarHidden.value = false;
  }
  return {
    mobile,
    mobileSurface,
    mobileActionsOpen,
    mobileSidebarOpen,
    sidebarInvisible,
    showSidebar,
  };
}

/** Commands and reactions that switch mobile surfaces; terminals appear only if the profile has them. */
export function registerMobileCommands(options: {
  editorCommands: ReturnType<typeof useCommandScope>;
  capabilities: Readonly<WorkspaceCapabilities>;
  surface: Ref<MobileSurface>;
  actionsOpen: Ref<boolean>;
  mobile: Ref<boolean>;
  activeKey: Ref<string | undefined>;
  focusedPanel: () => string | undefined;
  restoringSession: Ref<boolean>;
}) {
  const { editorCommands, capabilities, surface, actionsOpen, mobile } = options;
  editorCommands.scope.registerCommand({
    id: "ide.workbench.mobile.surface.show",
    title: "Открыть мобильную поверхность",
    description:
      "Переключает мобильный интерфейс между редактором, файлами слева и терминалами справа, сохраняя сессии.",
    arguments: { surface: "editor, files или terminal" },
    enabled: () => mobile.value,
    run: (value) => {
      const { surface: target } = commandArgs(value);
      if (
        (target === "terminal" && !capabilities.terminals) ||
        (target !== "editor" && target !== "files" && target !== "terminal")
      )
        throw new Error("surface: editor, files или terminal");
      surface.value = target;
      actionsOpen.value = false;
    },
  });
  editorCommands.scope.registerCommand({
    id: "ide.workbench.mobile.actions.toggle",
    title: "Показать действия проекта",
    description: "Раскрывает команды запуска проекта и создания терминалов в мобильном интерфейсе.",
    enabled: () => mobile.value,
    run: () => {
      actionsOpen.value = !actionsOpen.value;
    },
  });
  watch(options.activeKey, (key) => {
    if (key) surface.value = "editor";
  });
  watch(options.focusedPanel, (id) => {
    if (mobile.value && !options.restoringSession.value && id?.startsWith("terminal:"))
      surface.value = "terminal";
  });
  watch(mobile, () => {
    surface.value = "editor";
    actionsOpen.value = false;
  });
}
