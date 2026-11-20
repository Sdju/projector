import { computed, shallowRef, watch, type Ref } from "vue";
import {
  extendSidebarRegistry,
  groupSidebar,
  type SidebarRegistry,
} from "../../workspace-api/index.ts";
import { commandArgs } from "../../../common/utilities/commands.ts";
import type { RegisterWorkspaceCommand } from "./right-panel.ts";
import { useActionOrder } from "./action-order.ts";

export type SidebarSide = "left" | "right";

interface SidebarMove {
  from: string;
  side?: SidebarSide;
  to?: string;
  after?: boolean;
}

function createSidebarLayout(options: {
  projectId: () => string;
  left: SidebarRegistry;
  right: SidebarRegistry;
  rightAvailable: () => boolean;
  canTransfer: () => boolean;
}) {
  const legacy = useActionOrder("sidebar");
  const saved = useActionOrder(() => `sidebar-layout:${options.projectId()}`);
  const drag = shallowRef<{ id: string; side: SidebarSide }>();
  const groups = computed(() =>
    groupSidebar([...options.left.list(), ...options.right.list()]).map(([root, ...children]) => ({
      id: root!.id,
      utility: !!root!.utility,
      members: [root!, ...children].map((item) => item.id),
    })),
  );
  const groupOf = (id: string) => groups.value.find((group) => group.members.includes(id));
  const entry = (side: SidebarSide, id: string) => `${side}:${id}`;
  function assigned(id: string, order = saved.order.value): SidebarSide {
    return options.right.has(id) || order.includes(entry("right", id)) ? "right" : "left";
  }
  function sideOf(id: string): SidebarSide {
    const root = groupOf(id)?.id ?? id;
    if (!options.rightAvailable() && options.left.has(root)) return "left";
    return assigned(root);
  }
  function sort<T extends { id: string }>(items: T[]) {
    const ordered = legacy.sort(items, (item) => item.id);
    return saved.sort(ordered, (item) => entry(assigned(item.id), item.id));
  }
  function canMove(from: string, side: SidebarSide, to?: string) {
    const source = groupOf(from);
    if (!source) return false;
    const cross = sideOf(from) !== side;
    if (cross && (!options.canTransfer() || !options.left.has(source.id))) return false;
    if (!to) return cross;
    const target = groupOf(to);
    if (!target || source === target || sideOf(to) !== side || source.utility !== target.utility)
      return false;
    // A fallback rail can show both sets, but reordering it must retain their desktop sides.
    return options.rightAvailable() || assigned(source.id) === assigned(target.id);
  }
  async function move({ from, side: requestedSide, to, after }: SidebarMove) {
    await saved.load();
    const side = requestedSide ?? sideOf(from);
    if (!canMove(from, side, to)) return false;
    const source = groupOf(from)!;
    const target = to ? groupOf(to) : undefined;
    const cross = sideOf(from) !== side;
    if (!cross && target && !saved.order.value.length) {
      await legacy.move(
        sort(groups.value.filter((group) => sideOf(group.id) === side)).map((group) => group.id),
        source.id,
        target.id,
        !!after,
      );
      return false;
    }
    let transferred = false;
    await saved.update((order) => {
      if (!canMove(from, side, to)) return;
      const current = assigned(source.id, order);
      const destination = cross ? side : current;
      const ids = legacy.sort(groups.value, (group) => group.id);
      const entries = new Set([...order, ...ids.map(({ id }) => entry(assigned(id, order), id))]);
      entries.delete(entry(current, source.id));
      const updated = [...entries];
      const anchor = target ? updated.indexOf(entry(destination, target.id)) : -1;
      const index = anchor < 0 ? updated.length : anchor + Number(!!after);
      updated.splice(index, 0, entry(destination, source.id));
      transferred = cross;
      return updated;
    });
    return transferred;
  }
  return { drag, sideOf, sort, canMove, move };
}

export type SidebarLayout = ReturnType<typeof createSidebarLayout>;

export function useWorkspaceSidebarLayout(options: {
  projectId: () => string;
  sections: Ref<SidebarRegistry>;
  asideRegistry: SidebarRegistry;
  section: Ref<string>;
  asideSection: Ref<string>;
  showSidebar: () => void;
  showAside: () => void;
  rightAvailable: () => boolean;
  canTransfer: () => boolean;
  register: RegisterWorkspaceCommand;
}) {
  const { sections, asideRegistry, section, asideSection } = options;
  const layout = createSidebarLayout({
    projectId: options.projectId,
    left: {
      list: () => sections.value.list(),
      has: (id) => sections.value.has(id),
      get: (id) => sections.value.get(id),
    },
    right: asideRegistry,
    rightAvailable: options.rightAvailable,
    canTransfer: options.canTransfer,
  });
  const movedSections = computed(() =>
    sections.value.list().filter((type) => layout.sideOf(type.id) === "right"),
  );
  const rightSections = extendSidebarRegistry(asideRegistry, () => movedSections.value);
  const leftSections = computed(() =>
    sections.value.list().filter((type) => layout.sideOf(type.id) === "left"),
  );
  watch([leftSections, section], ([types, selected]) => {
    if (!types.some((type) => type.id === selected))
      section.value = types.find((type) => type.id === "files")?.id ?? types[0]?.id ?? "";
  });
  watch([movedSections, asideSection], ([, selected]) => {
    if (!rightSections.has(selected)) asideSection.value = rightSections.list()[0]?.id ?? "";
  });
  function showSection(id: string) {
    if (layout.sideOf(id) === "right") {
      asideSection.value = id;
      options.showAside();
    } else {
      section.value = id;
      options.showSidebar();
    }
  }
  options.register(
    "ide.workbench.section.show",
    "Открыть раздел боковой панели",
    (value) => {
      const id = commandArgs(value).section;
      if (typeof id !== "string" || !sections.value.has(id))
        throw new Error(
          `section: ${sections.value
            .list()
            .map((type) => type.id)
            .join(", ")}`,
        );
      showSection(id);
    },
    () => true,
    undefined,
    {
      description:
        "Переключает боковую панель на раздел проекта (файлы, поиск, Git и другие, если они есть у проекта) и показывает её.",
      arguments: { section: "Идентификатор раздела: files, search, git, docker, issues и т. д." },
    },
  );
  options.register(
    "ide.workbench.section.move",
    "Переместить раздел боковой панели",
    async (value) => {
      const { from, side, to, after } = commandArgs(value);
      if (
        typeof from !== "string" ||
        (side !== undefined && side !== "left" && side !== "right") ||
        (to !== undefined && typeof to !== "string") ||
        (after !== undefined && typeof after !== "boolean") ||
        (side === undefined && to === undefined)
      )
        throw new Error("Укажите from и сторону или соседний раздел");
      if (await layout.move({ from, side, to, after })) showSection(from);
    },
    () => true,
    undefined,
    {
      description: "Меняет сторону или порядок группы разделов и сохраняет раскладку.",
      arguments: {
        from: "Идентификатор перемещаемого раздела",
        side: "Сторона назначения (left или right). Без стороны сортирует текущую панель.",
        to: "Идентификатор соседней группы. Без него переносит в конец.",
        after: "Поместить после соседней группы",
      },
    },
  );
  return { layout, movedSections, rightSections, showSection };
}
