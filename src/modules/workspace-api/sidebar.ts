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
