/**
 * Модель раскладки блоков в стиле VS Code: дерево разделителей (`split`) и групп вкладок (`group`).
 * Все операции чистые: принимают раскладку и возвращают новую (или ту же ссылку, если ничего не изменилось).
 * Панели — непрозрачные строковые id; смысл им придаёт вызывающий код. Каждая панель находится ровно в одной группе.
 */
export type DockDirection = "row" | "column";
export type DockEdge = "left" | "right" | "top" | "bottom";
export type DockZone = "center" | DockEdge;

export interface DockGroup {
  type: "group";
  id: string;
  panels: string[];
  active: string;
  /** Подсказка назначения («editor», «terminal»): помогает выбрать группу для новой панели. */
  role?: string;
  hidden?: boolean;
  /** Пустая группа не удаляется, а показывает подсказку. */
  keepEmpty?: boolean;
}
export interface DockSplit {
  type: "split";
  id: string;
  direction: DockDirection;
  children: DockNode[];
  /** Доли детей; в сумме 1. Скрытые дети сохраняют свою долю. */
  sizes: number[];
}
export type DockNode = DockGroup | DockSplit;
export interface DockLayout {
  root: DockNode;
  focused: string;
  /** Только на время сессии: развёрнутая на весь док группа. */
  maximized?: string;
}
/**
 * Куда поместить панель. `groupId` + `zone: center` — вкладка в группу (на позицию `index`);
 * `groupId` + край — разделить эту группу; край без `groupId` — разделить весь док.
 */
export interface DockTarget {
  groupId?: string;
  zone?: DockZone;
  index?: number;
}

const maxDepth = 8;
const rootEdgeShare = 0.35;

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const isEdge = (zone?: DockZone): zone is DockEdge => !!zone && zone !== "center";

function emptyGroup(id: string, role?: string): DockGroup {
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
export const dockPanels = (layout: DockLayout) => dockGroups(layout).flatMap((group) => group.panels);
export function isNodeVisible(node: DockNode): boolean {
  return node.type === "group" ? !node.hidden : node.children.some(isNodeVisible);
}

function locate(
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

function idFactory(layout: DockLayout) {
  let max = 0;
  const visit = (node: DockNode) => {
    const match = /^[gs](\d+)$/.exec(node.id);
    if (match) max = Math.max(max, Number(match[1]));
    if (node.type === "split") node.children.forEach(visit);
  };
  visit(layout.root);
  return (prefix: "g" | "s") => `${prefix}${++max}`;
}

function normalizeSizes(sizes: number[]): number[] {
  const safe = sizes.map((size) => (Number.isFinite(size) && size > 0 ? size : 0));
  const total = safe.reduce((sum, size) => sum + size, 0);
  return total > 0 ? safe.map((size) => size / total) : safe.map(() => 1 / safe.length);
}

function normalizeNode(node: DockNode): DockNode | undefined {
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

function finish(layout: DockLayout, preferredFocus?: string): DockLayout {
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
function commit(before: DockLayout, after: DockLayout): DockLayout {
  return JSON.stringify(before) === JSON.stringify(after) ? before : after;
}

function detach(layout: DockLayout, panel: string): DockGroup | undefined {
  const group = groupOfPanel(layout, panel);
  if (!group) return;
  const index = group.panels.indexOf(panel);
  group.panels.splice(index, 1);
  if (group.active === panel)
    group.active = group.panels[Math.min(index, group.panels.length - 1)] ?? "";
  return group;
}

function insertBeside(
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

function newGroup(id: string, panel: string): DockGroup {
  return { type: "group", id, panels: [panel], active: panel };
}

function placeInto(layout: DockLayout, panel: string, target: DockTarget, activate: boolean) {
  const ids = idFactory(layout);
  const groups = dockGroups(layout);
  const destination =
    groups.find((group) => group.id === target.groupId) ??
    groups.find((group) => group.id === layout.focused) ??
    groups[0]!;
  if (isEdge(target.zone)) {
    const group = newGroup(ids("g"), panel);
    const anchor = target.groupId && groups.some((item) => item.id === target.groupId)
      ? destination
      : layout.root;
    insertBeside(layout, anchor, group, target.zone, ids, anchor === layout.root ? rootEdgeShare : 0.5);
    if (activate) layout.focused = group.id;
    return group;
  }
  const index = Math.max(0, Math.min(target.index ?? destination.panels.length, destination.panels.length));
  destination.panels.splice(index, 0, panel);
  if (activate || !destination.active) destination.active = panel;
  if (activate) {
    delete destination.hidden;
    layout.focused = destination.id;
  }
  return destination;
}

export function activatePanel(layout: DockLayout, panel: string): DockLayout {
  const next = copy(layout);
  const group = groupOfPanel(next, panel);
  if (!group) return layout;
  group.active = panel;
  delete group.hidden;
  next.focused = group.id;
  if (next.maximized && next.maximized !== group.id) delete next.maximized;
  return commit(layout, finish(next));
}

export function focusGroup(layout: DockLayout, groupId: string): DockLayout {
  const next = copy(layout);
  const group = findDockGroup(next, groupId);
  if (!group || group.hidden) return layout;
  next.focused = groupId;
  return commit(layout, next);
}

export function addPanel(
  layout: DockLayout,
  panel: string,
  target: DockTarget = {},
  activate = true,
): DockLayout {
  if (groupOfPanel(layout, panel)) return activate ? activatePanel(layout, panel) : layout;
  const next = copy(layout);
  const group = placeInto(next, panel, target, activate);
  return commit(layout, finish(next, activate ? group.id : undefined));
}

export function removePanel(layout: DockLayout, panel: string): DockLayout {
  const next = copy(layout);
  if (!detach(next, panel)) return layout;
  return commit(layout, finish(next));
}

export function movePanel(layout: DockLayout, panel: string, target: DockTarget): DockLayout {
  const source = groupOfPanel(layout, panel);
  const destination = target.groupId ? findDockGroup(layout, target.groupId) : undefined;
  if (!source) return layout;
  if (!destination && !isEdge(target.zone)) return layout;
  // Разделять группу единственной вкладкой бессмысленно: она просто останется на месте.
  if (isEdge(target.zone) && destination === source && source.panels.length === 1) return layout;
  const next = copy(layout);
  const from = groupOfPanel(next, panel)!;
  const to = destination ? findDockGroup(next, destination.id) : undefined;
  if (isEdge(target.zone)) {
    const ids = idFactory(next);
    detach(next, panel);
    const group = newGroup(ids("g"), panel);
    const anchor = to ?? next.root;
    insertBeside(next, anchor, group, target.zone, ids, anchor === next.root ? rootEdgeShare : 0.5);
    return commit(layout, finish(next, group.id));
  }
  if (from === to) {
    const original = from.panels.indexOf(panel);
    const wanted = target.index ?? from.panels.length;
    from.panels.splice(original, 1);
    from.panels.splice(Math.max(0, Math.min(wanted > original ? wanted - 1 : wanted, from.panels.length)), 0, panel);
    from.active = panel;
    return commit(layout, finish(next, from.id));
  }
  detach(next, panel);
  const group = placeInto(next, panel, { groupId: to!.id, zone: "center", index: target.index }, true);
  return commit(layout, finish(next, group.id));
}

export function reorderPanels(layout: DockLayout, groupId: string, order: string[]): DockLayout {
  const next = copy(layout);
  const group = findDockGroup(next, groupId);
  if (
    !group ||
    order.length !== group.panels.length ||
    new Set(order).size !== order.length ||
    order.some((id) => !group.panels.includes(id))
  )
    return layout;
  group.panels = order;
  return commit(layout, next);
}

export function replacePanel(layout: DockLayout, from: string, to: string): DockLayout {
  const next = copy(layout);
  const group = groupOfPanel(next, from);
  if (!group || groupOfPanel(next, to)) return layout;
  group.panels[group.panels.indexOf(from)] = to;
  if (group.active === from) group.active = to;
  return commit(layout, next);
}

export function setGroupHidden(layout: DockLayout, groupId: string, hidden: boolean): DockLayout {
  const next = copy(layout);
  const group = findDockGroup(next, groupId);
  if (!group) return layout;
  group.hidden = hidden || undefined;
  return commit(layout, finish(next, hidden ? undefined : groupId));
}

export function toggleMaximized(layout: DockLayout, groupId: string): DockLayout {
  const next = copy(layout);
  const group = findDockGroup(next, groupId);
  if (!group || group.hidden) return layout;
  if (next.maximized === groupId) delete next.maximized;
  else next.maximized = groupId;
  next.focused = groupId;
  return commit(layout, next);
}

export function setSplitSizes(layout: DockLayout, splitId: string, sizes: number[]): DockLayout {
  const next = copy(layout);
  const found = locate(next.root, splitId);
  if (found?.node.type !== "split" || sizes.length !== found.node.children.length) return layout;
  found.node.sizes = normalizeSizes(sizes);
  return commit(layout, next);
}

/**
 * Приводит раскладку в соответствие с реальным набором панелей: убирает исчезнувшие и добавляет новые.
 * `exists` возвращает undefined, пока источник панелей не загружен: такие панели не трогаются.
 */
export function reconcileDock(
  layout: DockLayout,
  options: {
    ids: string[];
    exists: (panel: string) => boolean | undefined;
    place?: (panel: string, layout: DockLayout) => DockTarget | undefined;
  },
): DockLayout {
  const next = copy(layout);
  for (const panel of dockPanels(next)) if (options.exists(panel) === false) detach(next, panel);
  for (const panel of options.ids)
    if (!groupOfPanel(next, panel))
      placeInto(next, panel, options.place?.(panel, next) ?? {}, false);
  return commit(layout, finish(next));
}

export function serializeDockLayout(layout: DockLayout): DockLayout {
  const value = copy(layout);
  delete value.maximized;
  return value;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function parseNode(
  value: unknown,
  depth: number,
  seen: Set<string>,
  panels: Set<string>,
): DockNode | undefined {
  if (
    depth > maxDepth ||
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    value.id.length > 32 ||
    seen.has(value.id)
  )
    return;
  seen.add(value.id);
  if (value.type === "group") {
    if (!Array.isArray(value.panels) || value.panels.length > 500) return;
    const list: string[] = [];
    for (const panel of value.panels) {
      if (typeof panel !== "string" || !panel || panel.length > 1024 || panels.has(panel)) continue;
      panels.add(panel);
      list.push(panel);
    }
    return {
      type: "group",
      id: value.id,
      panels: list,
      active: typeof value.active === "string" && list.includes(value.active) ? value.active : (list[0] ?? ""),
      ...(typeof value.role === "string" && value.role.length <= 20 ? { role: value.role } : {}),
      ...(value.hidden === true ? { hidden: true } : {}),
      ...(value.keepEmpty === true ? { keepEmpty: true } : {}),
    };
  }
  if (
    value.type !== "split" ||
    (value.direction !== "row" && value.direction !== "column") ||
    !Array.isArray(value.children) ||
    value.children.length > 16
  )
    return;
  const children: DockNode[] = [];
  const sizes: number[] = [];
  for (const [index, source] of value.children.entries()) {
    const child = parseNode(source, depth + 1, seen, panels);
    if (!child) continue;
    children.push(child);
    const size = Array.isArray(value.sizes) ? value.sizes[index] : undefined;
    sizes.push(typeof size === "number" && Number.isFinite(size) && size > 0 ? size : 1);
  }
  if (!children.length) return;
  return { type: "split", id: value.id, direction: value.direction, children, sizes: normalizeSizes(sizes) };
}

/** Читает сохранённую раскладку; повреждённые данные дают undefined, а не исключение. */
export function parseDockLayout(value: unknown): DockLayout | undefined {
  if (!isRecord(value)) return;
  const root = parseNode(value.root, 0, new Set(), new Set());
  if (!root) return;
  return finish({ root, focused: typeof value.focused === "string" ? value.focused : "" });
}
