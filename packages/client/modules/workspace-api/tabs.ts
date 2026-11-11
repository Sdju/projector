export type TabParams = Record<string, unknown>;

/** Numeric identity of a tab: pipelines/jobs pass `id`, issues/PRs pass `number`. */
export function tabRecordId(params: TabParams, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
    }
  }
}

/** Tab params for a CI record: only identity fields, so a full pipeline object cannot overwrite `path`. */
export function ciTabParams(record: TabParams): { id?: number; number?: number; title?: string } {
  const id = tabRecordId(record, "id", "number");
  const number = tabRecordId(record, "number");
  const title = [record.title, record.name, record.ref].find(
    (value): value is string => typeof value === "string" && !!value.trim(),
  );
  return {
    ...(id !== undefined ? { id } : {}),
    ...(number !== undefined && number !== id ? { number } : {}),
    ...(title ? { title: title.trim() } : {}),
  };
}

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
  /** Tooltip of the tab; `content` is the hint the tab may update once it loads. */
  title(params: P, content: string): string;
  /** Initial text shown before the tab loads its own data. */
  hint?(params: P): string;
  /** Opens as a preview tab (the next preview replaces it) unless the caller pins it. */
  preview?: boolean;
  /** Short note on the right of the tab breadcrumb. */
  subtitle?: string;
  /** What the built-in agent sees when it reads the tab; the default says it has no text. */
  read?(params: P, content: string): { text?: string; note?: string };
  /** Parameters for a tab opened by its command; lets a kind open a new instance each time. */
  create?(): P;
  /** An IDE command that opens the tab; the workspace registers it with the kind. */
  command?: {
    id: string;
    title: string;
    description?: string;
    requires?: string;
    /** The command takes the parameters of the tab to open as its arguments (described here). */
    arguments?: Record<string, string>;
    /** Parameters the command may take besides what `create` gives (described here). */
    optional?: Record<string, string>;
  };
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

function recordCaption(label: string, params: TabParams, keys: string[]) {
  const record = tabRecordId(params, ...keys);
  const title = typeof params.title === "string" ? params.title.trim() : "";
  const name = title ? `${title} · ` : "";
  return record === undefined ? `${name}${label}` : `${name}${label} #${record}`;
}

function recordTab(kind: string, label: string, keys: string[]) {
  return defineTab<{ id?: number; number?: number; title?: string }>({
    id: kind,
    key: (params) => `${kind}:${tabRecordId(params, ...keys) ?? "unknown"}`,
    path: (params) => {
      const record = tabRecordId(params, ...keys);
      return record === undefined ? label : `${label} #${record}`;
    },
    title: (params) => recordCaption(label, params, keys),
    hint: (params) => (typeof params.title === "string" ? params.title : ""),
    preview: true,
  });
}

/** Issue/PR tab: prefers `number`, then `id`. Never interpolates `#undefined`. */
export const numberedTab = (id: string, label: string) => recordTab(id, label, ["number", "id"]);

/** Pipeline/job tab: prefers API `id`, then sequential `number`. */
export const idTab = (kind: string, label: string) => recordTab(kind, label, ["id", "number"]);

/** A tab without parameters: one per workspace. */
export const singletonTab = (
  id: string,
  key: string,
  path: string,
  title: string,
  extra: Pick<TabType, "subtitle" | "command"> = {},
) => defineTab({ id, key: () => key, path: () => path, title: () => title, ...extra });

export interface TabRegistry {
  has(id: string): boolean;
  get(id: string): TabType | undefined;
  list(): TabType[];
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
    list: () => [...types.values()],
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
