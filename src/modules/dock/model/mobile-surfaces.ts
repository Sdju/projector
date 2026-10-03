import { dockGroups, type DockLayout } from "./layout.ts";

export type MobileDockSide = "editor" | "terminal";

/** A mobile view of every panel, independent of desktop splits, hiding and maximization. */
export function mobileDockSurfaces(
  layout: DockLayout,
  isTerminal: (id: string) => boolean,
  last: Record<MobileDockSide, string>,
  order: Record<MobileDockSide, string[]> = { editor: [], terminal: [] },
) {
  const groups = dockGroups(layout);
  const panels = groups.flatMap((group) => group.panels);
  const focused = groups.find((group) => group.id === layout.focused)?.active;
  return (["editor", "terminal"] as const).map((side) => {
    const available = panels.filter((id) => isTerminal(id) === (side === "terminal"));
    const ids = [...order[side].filter((id) => available.includes(id)),
      ...available.filter((id) => !order[side].includes(id))];
    const active = focused && ids.includes(focused) ? focused
      : ids.includes(last[side]) ? last[side] : ids[0] ?? "";
    return { side, ids, active };
  });
}
