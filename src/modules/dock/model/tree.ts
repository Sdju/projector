import type {
  DockDirection,
  DockEdge,
  DockZone,
  DockGroup,
  DockSplit,
  DockNode,
  DockLayout,
  DockTarget,
} from "./types.ts";

export const maxDepth = 8;
export const rootEdgeShare = 0.35;

export const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export const isEdge = (zone?: DockZone): zone is DockEdge => !!zone && zone !== "center";

export function emptyGroup(id: string, role?: string): DockGroup {
  return { type: "group", id, panels: [], active: "", keepEmpty: true, ...(role ? { role } : {}) };
}

/** Редактор слева и терминалы справа — привычная раскладка по умолчанию. */
export function createDockLayout(): DockLayout {
  return {
    root: {
      type: "split",
      id: "s1",
      direction: "row",
      children: [emptyGroup("g1", "editor"), emptyGroup("g2", "terminal")],
      sizes: [0.65, 0.35],
    },
    focused: "g1",
  };
}

export function dockGroups(layout: DockLayout): DockGroup[] {
  const result: DockGroup[] = [];
  const visit = (node: DockNode) =>
    node.type === "group" ? result.push(node) : node.children.forEach(visit);
  visit(layout.root);
  return result;
}
export const findDockGroup = (layout: DockLayout, id: string) =>
  dockGroups(layout).find((group) => group.id === id);
export const groupOfPanel = (layout: DockLayout, panel: string) =>
  dockGroups(layout).find((group) => group.panels.includes(panel));
export const dockPanels = (layout: DockLayout) =>
  dockGroups(layout).flatMap((group) => group.panels);
export function isNodeVisible(node: DockNode): boolean {
  return node.type === "group" ? !node.hidden : node.children.some(isNodeVisible);
}

export function locate(
  root: DockNode,
  id: string,
): { node: DockNode; parent?: DockSplit; index: number } | undefined {
  if (root.id === id) return { node: root, index: -1 };
  if (root.type !== "split") return;
  for (const [index, child] of root.children.entries()) {
    if (child.id === id) return { node: child, parent: root, index };
    const found = locate(child, id);
    if (found) return found;
  }
}

export function idFactory(layout: DockLayout) {
  let max = 0;
  const visit = (node: DockNode) => {
    const match = /^[gs](\d+)$/.exec(node.id);
    if (match) max = Math.max(max, Number(match[1]));
    if (node.type === "split") node.children.forEach(visit);
  };
  visit(layout.root);
  return (prefix: "g" | "s") => `${prefix}${++max}`;
}

export function normalizeSizes(sizes: number[]): number[] {
  const safe = sizes.map((size) => (Number.isFinite(size) && size > 0 ? size : 0));
  const total = safe.reduce((sum, size) => sum + size, 0);
  return total > 0 ? safe.map((size) => size / total) : safe.map(() => 1 / safe.length);
}

export function normalizeNode(node: DockNode): DockNode | undefined {
  if (node.type === "group") {
    if (!node.panels.length && !node.keepEmpty) return;
    if (!node.panels.includes(node.active)) node.active = node.panels[0] ?? "";
    return node;
  }
  const children: DockNode[] = [];
  const sizes: number[] = [];
  const own = normalizeSizes(node.sizes.length === node.children.length ? node.sizes : []);
  for (const [index, source] of node.children.entries()) {
    const child = normalizeNode(source);
    if (!child) continue;
    const size = own[index] ?? 1 / node.children.length;
    if (child.type === "split" && child.direction === node.direction) {
      const inner = normalizeSizes(child.sizes);
      child.children.forEach((item, position) => {
        children.push(item);
        sizes.push(size * inner[position]!);
      });
    } else {
      children.push(child);
      sizes.push(size);
    }
  }
  if (!children.length) return;
  if (children.length === 1) return children[0];
  node.children = children;
  node.sizes = normalizeSizes(sizes);
  return node;
}

export function finish(layout: DockLayout, preferredFocus?: string): DockLayout {
  // Подсказка пустого блока нужна только пока нет другой группы того же назначения.
  const retained = new Map<string, DockGroup>();
  const candidates = dockGroups(layout);
  for (const group of candidates) {
    if (!group.role) continue;
    const previous = retained.get(group.role);
    if (!previous || (!previous.panels.length && group.panels.length))
      retained.set(group.role, group);
  }
  for (const group of candidates)
    if (group.role && !group.panels.length && retained.get(group.role) !== group) {
      if (group.keepEmpty) retained.get(group.role)!.keepEmpty = true;
      delete group.keepEmpty;
    }
  layout.root = normalizeNode(layout.root) ?? emptyGroup("g1");
  const groups = dockGroups(layout);
  if (preferredFocus && groups.some((group) => group.id === preferredFocus))
    layout.focused = preferredFocus;
  const focus = groups.find((group) => group.id === layout.focused);
  if (!focus || (focus.hidden && groups.some((group) => !group.hidden)))
    layout.focused = (groups.find((group) => !group.hidden) ?? groups[0]!).id;
  if (layout.maximized && !groups.some((group) => group.id === layout.maximized && !group.hidden))
    delete layout.maximized;
  return layout;
}

/** Возвращает исходную ссылку, если содержимое не изменилось: реактивность не срабатывает впустую. */
export function commit(before: DockLayout, after: DockLayout): DockLayout {
  return JSON.stringify(before) === JSON.stringify(after) ? before : after;
}

export function detach(layout: DockLayout, panel: string): DockGroup | undefined {
  const group = groupOfPanel(layout, panel);
  if (!group) return;
  const index = group.panels.indexOf(panel);
  group.panels.splice(index, 1);
  if (group.active === panel)
    group.active = group.panels[Math.min(index, group.panels.length - 1)] ?? "";
  return group;
}

export function insertBeside(
  layout: DockLayout,
  node: DockNode,
  group: DockGroup,
  zone: DockEdge,
  ids: ReturnType<typeof idFactory>,
  share: number,
) {
  const direction: DockDirection = zone === "left" || zone === "right" ? "row" : "column";
  const before = zone === "left" || zone === "top";
  const found = locate(layout.root, node.id);
  if (found?.parent && found.parent.direction === direction) {
    const { parent, index } = found;
    const size = parent.sizes[index]!;
    parent.sizes[index] = size * (1 - share);
    const at = index + (before ? 0 : 1);
    parent.children.splice(at, 0, group);
    parent.sizes.splice(at, 0, size * share);
    return;
  }
  const split: DockSplit = {
    type: "split",
    id: ids("s"),
    direction,
    children: before ? [group, node] : [node, group],
    sizes: before ? [share, 1 - share] : [1 - share, share],
  };
  if (found?.parent) found.parent.children[found.index] = split;
  else layout.root = split;
}

export function newGroup(id: string, panel: string, source?: DockGroup): DockGroup {
  return {
    type: "group",
    id,
    panels: [panel],
    active: panel,
    ...(source?.role ? { role: source.role } : {}),
    ...(source?.keepEmpty ? { keepEmpty: true } : {}),
  };
}

export function placeInto(
  layout: DockLayout,
  panel: string,
  target: DockTarget,
  activate: boolean,
) {
  const ids = idFactory(layout);
  const groups = dockGroups(layout);
  const destination =
    groups.find((group) => group.id === target.groupId) ??
    groups.find((group) => group.id === layout.focused) ??
    groups[0]!;
  if (isEdge(target.zone)) {
    const group = newGroup(ids("g"), panel, target.groupId ? destination : undefined);
    const anchor =
      target.groupId && groups.some((item) => item.id === target.groupId)
        ? destination
        : layout.root;
    insertBeside(
      layout,
      anchor,
      group,
      target.zone,
      ids,
      anchor === layout.root ? rootEdgeShare : 0.5,
    );
    if (activate) layout.focused = group.id;
    return group;
  }
  const index = Math.max(
    0,
    Math.min(target.index ?? destination.panels.length, destination.panels.length),
  );
  destination.panels.splice(index, 0, panel);
  if (activate || !destination.active) destination.active = panel;
  if (activate) {
    delete destination.hidden;
    layout.focused = destination.id;
  }
  return destination;
}
