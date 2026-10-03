import type { DockNode, DockLayout } from "./types.ts";
import { maxDepth, copy, normalizeSizes, finish } from "./tree.ts";

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
      active:
        typeof value.active === "string" && list.includes(value.active)
          ? value.active
          : (list[0] ?? ""),
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
  return {
    type: "split",
    id: value.id,
    direction: value.direction,
    children,
    sizes: normalizeSizes(sizes),
  };
}

/** Читает сохранённую раскладку; повреждённые данные дают undefined, а не исключение. */
export function parseDockLayout(value: unknown): DockLayout | undefined {
  if (!isRecord(value)) return;
  const root = parseNode(value.root, 0, new Set(), new Set());
  if (!root) return;
  return finish({ root, focused: typeof value.focused === "string" ? value.focused : "" });
}
