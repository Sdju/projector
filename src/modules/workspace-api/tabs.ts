export type TabParams = Record<string, unknown>;

/**
 * A kind of service tab (settings, an issue, repository info). The provider that owns the
 * feature registers it; the workspace opens tabs by `id` and never branches on a kind itself.
 */
export interface TabType<P extends TabParams = TabParams> {
  id: string;
  /** Identity: opening the same key again focuses the existing tab. */
  key(params: P): string;
  /** Label in the tab strip. */
  path(params: P): string;
  /** Tooltip of the tab. */
  title(params: P): string;
  /** Initial text shown before the tab loads its own data. */
  hint?(params: P): string;
  /** Short note on the right of the tab breadcrumb. */
  subtitle?: string;
}

/**
 * What the host does with a tab of a kind; supplied by whoever owns the tab state
 * (for example the page holding the unsaved project settings form).
 */
export interface TabBehavior {
  dirty?(): boolean;
  /** Return `false` to keep the tab open. */
  beforeClose?(): boolean | undefined;
  /** Ctrl+S inside the tab. */
  save?(): void | Promise<void>;
}

/** Erases the parameter type so kinds with different params share one registry. */
export const defineTab = <P extends TabParams>(type: TabType<P>) => type as unknown as TabType;

/** A tab without parameters: one per workspace. */
export const singletonTab = (
  id: string,
  key: string,
  path: string,
  title: string,
  subtitle?: string,
) => defineTab({ id, key: () => key, path: () => path, title: () => title, subtitle });

export interface TabRegistry {
  has(id: string): boolean;
  get(id: string): TabType | undefined;
  /** Key of a parameterless tab; for panels that live outside the dock. */
  keyOf(id: string): string;
  /** Attaches host behavior to a kind; returns a function that detaches it. */
  behave(id: string, behavior: TabBehavior): () => void;
  behaviorOf(id: string | undefined): TabBehavior | undefined;
}

/** Later kinds win: a profile may replace a base kind with the same id. */
export function createTabRegistry(...groups: ReadonlyArray<readonly TabType[] | undefined>) {
  const types = new Map<string, TabType>();
  const behaviors = new Map<string, TabBehavior>();
  for (const group of groups) for (const type of group ?? []) types.set(type.id, type);
  const registry: TabRegistry = {
    has: (id) => types.has(id),
    get: (id) => types.get(id),
    keyOf(id) {
      const type = types.get(id);
      if (!type) throw new Error(`Неизвестный тип вкладки: ${id}`);
      return type.key({});
    },
    behave(id, behavior) {
      behaviors.set(id, behavior);
      return () => {
        if (behaviors.get(id) === behavior) behaviors.delete(id);
      };
    },
    behaviorOf: (id) => (id ? behaviors.get(id) : undefined),
  };
  return registry;
}
