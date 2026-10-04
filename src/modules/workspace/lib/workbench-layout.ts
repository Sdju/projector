import type {
  WorkspaceCapabilities,
  WorkspaceCapability,
  TabRegistry,
  WorkspaceProfile,
} from "../../workspace-api/index.ts";
import { computed, ref, watch, type Ref } from "vue";
import { commandArgs } from "../../../common/utilities/commands.ts";
import {
  activatePanel,
  addPanel,
  createDockLayout,
  dockGroups,
  findDockGroup,
  groupOfPanel,
  movePanel,
  reconcileDock,
  replacePanel,
  setGroupHidden,
  type DockGroup,
  type DockLayout,
  type DockTabInfo,
  type DockTarget,
} from "../../dock/index.ts";
import { useTerminalSessions } from "../../terminal/index.ts";
import type { TerminalProgram } from "../../../../core/modules/terminal/index.ts";
import type { OpenFile } from "../open-file.ts";
import { registerTabReader } from "./tab-reader.ts";

export interface WorkbenchLayoutContext {
  projectId: () => string;
  capabilities: Readonly<WorkspaceCapabilities>;
  /** Dock preset of the profile. */
  layout: WorkspaceProfile["layout"];
  tabs: Ref<OpenFile[]>;
  /** Куда поместить следующую открытую вкладку: заполняется при перетаскивании файла на блок. */
  pending: { target?: DockTarget };
  isDirty: (file: OpenFile) => boolean;
  tabTypes: TabRegistry;
  selectTab: (key: string) => void;
  closeTab: (key: string) => Promise<void>;
  closeManyTabs: (ids: string[]) => Promise<void>;
  showSidebar: () => void;
  register: (
    id: string,
    title: string,
    run: (args?: unknown) => unknown,
    enabled: (args?: unknown) => boolean,
    requires?: WorkspaceCapability,
    meta?: { description?: string; arguments?: Record<string, string> },
  ) => unknown;
}

/** Starting dock of a profile: a single editor group needs no terminal zone. */
export function initialDockLayout(kind: WorkspaceProfile["layout"]): DockLayout {
  if (kind === "full") return createDockLayout();
  return {
    root: { type: "group", id: "g1", panels: [], active: "", role: "editor", keepEmpty: true },
    focused: "g1",
  };
}

/** Раскладка блоков дока: файлы и терминалы как панели, их выбор, закрытие и команды раскладки. */
export function useWorkbenchLayout(ctx: WorkbenchLayoutContext) {
  const { tabs } = ctx;
  const { capabilities } = ctx;
  const initialLayout = (): DockLayout => initialDockLayout(ctx.layout);
  const layout = ref<DockLayout>(initialLayout());
  const restoringSession = ref(false);
  const fileOf = (id: string) => tabs.value.find((tab) => tab.key === id);
  const terminalPanel = (id: string) => `terminal:${id}`;
  const lastGroup: Partial<Record<"editor" | "terminal", string>> = {};
  const terminals = useTerminalSessions(() => ctx.projectId(), {
    enabled: capabilities.terminals,
    started: (id) => revealPanel(terminalPanel(id)),
    restarted: (previous, id) => {
      layout.value = replacePanel(layout.value, terminalPanel(previous), terminalPanel(id));
    },
  });
  const terminalPanels = computed(
    () => new Map(terminals.sessions.value.map((item) => [terminalPanel(item.id), item])),
  );
  const roleOf = (id: string) => (id.startsWith("terminal:") ? "terminal" : "editor");
  function place(id: string, current: DockLayout): DockTarget | undefined {
    if (ctx.pending.target) {
      const target = ctx.pending.target;
      ctx.pending.target = undefined;
      return target;
    }
    const role = roleOf(id);
    const holds = (group: DockGroup) => group.panels.some((panel) => roleOf(panel) === role);
    const groups = dockGroups(current);
    const group =
      groups.find((item) => item.id === current.focused && holds(item)) ??
      groups.find((item) => item.id === lastGroup[role]) ??
      groups.find(holds) ??
      groups.find((item) => item.role === role);
    return group
      ? { groupId: group.id, zone: "center" }
      : { zone: role === "terminal" ? "right" : "left" };
  }
  function reconcileLayout() {
    const keys = new Set(tabs.value.map((tab) => tab.key));
    layout.value = reconcileDock(layout.value, {
      role: roleOf,
      ids: [...keys, ...terminalPanels.value.keys()],
      exists: (id) =>
        keys.has(id) || terminalPanels.value.has(id)
          ? true
          : id.startsWith("terminal:")
            ? terminals.loaded.value
              ? false
              : undefined
            : restoringSession.value
              ? undefined
              : false,
      place,
    });
  }
  // Вкладки и сессии — источник истины: раскладка подстраивается под них сразу, без кадра рассинхрона.
  watch(
    () => [
      tabs.value.map((tab) => tab.key).join("\n"),
      terminals.sessions.value.map((item) => item.id).join("\n"),
      restoringSession.value,
      terminals.loaded.value,
    ],
    reconcileLayout,
    { flush: "sync", immediate: true },
  );
  const focusedGroup = computed(() => findDockGroup(layout.value, layout.value.focused));
  /** Файл активной вкладки в блоке с фокусом; пусто, если там терминал или блок пуст. */
  const activeKey = computed({
    get: () => {
      const id = focusedGroup.value?.active ?? "";
      return fileOf(id) ? id : "";
    },
    set: (key: string) => {
      if (key) revealPanel(key);
    },
  });
  function revealPanel(id: string) {
    const target = ctx.pending.target;
    const current = groupOfPanel(layout.value, id);
    if (current && target && (target.zone !== "center" || target.groupId !== current.id)) {
      ctx.pending.target = undefined;
      layout.value = movePanel(layout.value, id, target);
    } else
      layout.value = current
        ? activatePanel(layout.value, id)
        : addPanel(layout.value, id, place(id, layout.value));
    const group = groupOfPanel(layout.value, id);
    if (group) lastGroup[roleOf(id)] = group.id;
  }
  async function createTerminal(program: TerminalProgram) {
    const created = await terminals.create(program);
    if (created) revealPanel(terminalPanel(created.id));
  }
  function describePanel(id: string): DockTabInfo {
    const file = fileOf(id);
    if (file)
      return {
        id,
        label: file.virtual ? file.path : file.path.split("/").at(-1)!,
        title: file.virtual
          ? (ctx.tabTypes.get(file.virtual)?.title(file.params ?? {}, file.content) ?? file.path)
          : file.saveError
            ? `${file.path} · ${file.saveError}`
            : file.commit
              ? `${file.path} · ${file.parent || "∅"} → ${file.commit.slice(0, 7)}`
              : `${file.path}${file.original !== undefined ? (file.staged ? " · HEAD → index" : " · index → рабочий файл") : ""}`,
        dirty: ctx.isDirty(file),
        saving: !!file.saving,
        error: !!file.saveError,
        preview: !!file.preview && !ctx.isDirty(file),
      };
    const item = terminalPanels.value.get(id);
    if (item)
      return {
        id,
        label: terminals.nameOf(item),
        title: `${terminals.labelOf(item)}${item.status === "running" ? (item.activity?.state === "idle" ? " · ожидает ввода" : " · есть работающие процессы") : ""} · Двойной щелчок: переименовать`,
        renameable: true,
      };
    // Сессии ещё загружаются: не показываем технический id.
    return { id, label: id.startsWith("terminal:") ? "Терминал…" : id };
  }
  function selectPanel(id: string) {
    if (fileOf(id)) ctx.selectTab(id);
    else revealPanel(id);
  }
  function closePanel(id: string) {
    const item = terminalPanels.value.get(id);
    return item ? terminals.close(item.id) : ctx.closeTab(id);
  }
  async function closeManyPanels(ids: string[]) {
    const opened = ids.filter((id) => fileOf(id));
    await ctx.closeManyTabs(opened);
    if (opened.some((id) => fileOf(id))) return;
    await terminals.closeMany(
      ids.flatMap((id) => {
        const item = terminalPanels.value.get(id);
        return item ? [item.id] : [];
      }),
    );
  }
  function renamePanel(id: string, label: string) {
    const item = terminalPanels.value.get(id);
    if (item) void terminals.rename(item.id, label);
  }
  const hiddenGroups = computed(() => dockGroups(layout.value).filter((group) => group.hidden));
  const roleLabels: Record<string, string> = { editor: "Редактор", terminal: "Терминалы" };
  function groupLabel(group: DockGroup) {
    if (!group.panels.length) return roleLabels[group.role ?? ""] ?? "Блок";
    const label = describePanel(group.active).label;
    return group.panels.length > 1 ? `${label} +${group.panels.length - 1}` : label;
  }
  const showGroup = (id: string) => {
    layout.value = setGroupHidden(layout.value, id, false);
  };
  function resetLayout() {
    const current = activeKey.value;
    layout.value = initialLayout();
    ctx.showSidebar();
    reconcileLayout();
    if (current) revealPanel(current);
  }
  function panelArg(value?: unknown) {
    const args = commandArgs(value);
    if (args.id !== undefined && typeof args.id !== "string")
      throw new Error("id должен быть строкой");
    return (args.id as string | undefined) ?? focusedGroup.value?.active ?? "";
  }
  for (const [action, title, zone] of [
    ["splitRight", "Разделить вправо", "right"],
    ["splitDown", "Разделить вниз", "bottom"],
  ] as const)
    ctx.register(
      `ide.workbench.panel.${action}`,
      title,
      (value) => {
        const id = panelArg(value);
        layout.value = movePanel(layout.value, id, {
          groupId: groupOfPanel(layout.value, id)!.id,
          zone,
        });
      },
      (value) => (groupOfPanel(layout.value, panelArg(value))?.panels.length ?? 0) > 1,
    );
  ctx.register(
    "ide.workbench.panel.hideGroup",
    "Скрыть блок",
    (value) => {
      layout.value = setGroupHidden(
        layout.value,
        groupOfPanel(layout.value, panelArg(value))!.id,
        true,
      );
    },
    (value) => !!groupOfPanel(layout.value, panelArg(value)),
  );
  ctx.register("ide.workbench.layout.reset", "Сбросить раскладку блоков", resetLayout, () => true);
  ctx.register(
    "ide.workbench.terminal.new",
    "Новый терминал",
    async (value) => {
      const { program = "shell" } = commandArgs(value);
      if (!["shell", "codex", "claude", "opencode", "cursor"].includes(program as string))
        throw new Error("program: shell, codex, claude, opencode или cursor");
      await createTerminal(program as TerminalProgram);
    },
    () => !terminals.busy.value,
    "terminals",
  );
  registerTabReader({
    layout: () => layout.value,
    groups: dockGroups,
    fileOf,
    tabTypes: ctx.tabTypes,
    terminalOf: (id) => terminalPanels.value.get(id),
    label: (id) => describePanel(id).label,
    isDirty: ctx.isDirty,
    readTerminal: terminals.readText,
    register: (id, title, run, enabled, description, args) =>
      ctx.register(id, title, run, enabled, undefined, { description, arguments: args }),
  });
  return {
    layout,
    restoringSession,
    terminals,
    terminalPanels,
    fileOf,
    focusedGroup,
    activeKey,
    revealPanel,
    initialLayout,
    reconcileLayout,
    describePanel,
    selectPanel,
    closePanel,
    closeManyPanels,
    renamePanel,
    hiddenGroups,
    groupLabel,
    showGroup,
  };
}
