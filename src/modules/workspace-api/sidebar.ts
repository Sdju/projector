/**
 * A section of the workspace sidebar (files, search, issues, docker). The provider that owns
 * the feature registers it; the sidebar lists whatever the workspace has.
 */
export interface SidebarType {
  id: string;
  /** Tooltip and accessible name of the section button. */
  title: string;
  /** Capability that must be on for the section to exist. */
  requires?: string;
  /** IDE command that opens the section; the button runs it instead of just selecting. */
  command?: string;
  /** Section this one belongs to; grouped children sit next to their parent icon. */
  group?: string;
  /** View kind that draws the section; defaults to its id. */
  kind?: string;
  /** Parameters of a dynamic section instance (a commit tree, an opened request). */
  params?: Record<string, unknown>;
  /** A temporary section can be closed from the sidebar. */
  closable?: boolean;
  /** Short note about the source shown above the panel when the section is temporary. */
  source?: string;
}

export interface SidebarRegistry {
  has(id: string): boolean;
  get(id: string): SidebarType | undefined;
  list(): SidebarType[];
}

/** Later groups win by id; sections whose capability is off are left out. */
export function createSidebarRegistry(
  available: (capability: string) => boolean,
  ...groups: ReadonlyArray<readonly SidebarType[] | undefined>
) {
  const types = new Map<string, SidebarType>();
  for (const group of groups) for (const type of group ?? []) types.set(type.id, type);
  for (const [id, type] of types) if (type.requires && !available(type.requires)) types.delete(id);
  const registry: SidebarRegistry = {
    has: (id) => types.has(id),
    get: (id) => types.get(id),
    list: () => [...types.values()],
  };
  return registry;
}

/** A registry with sections that appear at runtime (a commit tree, an opened request). */
export function extendSidebarRegistry(
  base: SidebarRegistry,
  extra: () => readonly SidebarType[],
): SidebarRegistry {
  return {
    has: (id) => base.has(id) || extra().some((type) => type.id === id),
    get: (id) => extra().find((type) => type.id === id) ?? base.get(id),
    list: () => [...base.list(), ...extra()],
  };
}

/** Parents stay in place; children follow their parent, even when they were appended later. */
export function groupSidebar<T extends { id: string; group?: string }>(items: readonly T[]): T[][] {
  const ids = new Set(items.map((item) => item.id));
  const groups: T[][] = [];
  const byId = new Map<string, T[]>();
  for (const item of items) {
    if (item.group && ids.has(item.group)) continue;
    const group = [item];
    groups.push(group);
    byId.set(item.id, group);
  }
  for (const item of items) {
    if (!item.group || !ids.has(item.group)) continue;
    const parent = byId.get(item.group);
    if (parent) parent.push(item);
    else {
      const group = [item];
      groups.push(group);
      byId.set(item.id, group);
    }
  }
  return groups;
}
