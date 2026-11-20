/**
 * Public author API of browser plugins. The package has no imports from client or server
 * implementations: a plugin bundles this contract (types only, erased at build time) and receives
 * the host implementation as the `api` argument of `activate`.
 */

export const PLUGIN_API_VERSION = 1 as const;

export type PluginApiVersion = typeof PLUGIN_API_VERSION;

export interface Disposable {
  dispose(): void;
}

export type DisposableLike = Disposable | (() => void) | void;

/** Standard CodeMirror/Lezer highlight names a declarative language grammar may emit. */
export type LanguageToken =
  | "keyword"
  | "operatorKeyword"
  | "controlKeyword"
  | "modifier"
  | "operator"
  | "punctuation"
  | "string"
  | "regexp"
  | "escape"
  | "number"
  | "bool"
  | "null"
  | "atom"
  | "comment"
  | "typeName"
  | "className"
  | "namespace"
  | "variableName"
  | "functionName"
  | "propertyName"
  | "tagName"
  | "angleBracket"
  | "attributeName"
  | "attributeValue"
  | "meta"
  | "heading"
  | "link";

/**
 * One ordered regex rule of a streaming grammar. Patterns are JavaScript regular expressions
 * anchored at the current position; the host compiles and applies them itself, so the plugin
 * never supplies a CodeMirror extension object.
 */
export interface LanguageRule {
  pattern: string;
  /** `undefined` consumes the match without a highlight (whitespace). */
  token?: LanguageToken;
}

export interface LanguageRegistration {
  /** Must match a `projector.contributes.languages[].id` entry of the manifest. */
  id: string;
  rules: LanguageRule[];
  /** Match ASCII letters regardless of case. */
  caseInsensitive?: boolean;
}

export interface PluginViewContext {
  /** Project whose workspace shows the view. */
  projectId: string;
  /** Stable device page id (`""` on a direct local page). */
  device: string;
  /** Aborted when the view is closed, replaced or the plugin is disabled. */
  signal: AbortSignal;
  /** Tab parameters from the manifest command or the opener. */
  params: Readonly<Record<string, unknown>>;
  /** URL of a file relative to the browser entry directory, for this version and device. */
  assetUrl(relative: string): string;
  /** Runs a host `ide.*` command in the owning workspace scope. */
  commands: {
    run(id: string, args?: unknown): Promise<unknown>;
  };
  workspace: {
    /** Opens a project file through the workspace host. */
    openFile(path: string, options?: { line?: number; column?: number }): void;
    /** Opens a registered workspace tab by id. */
    openTab(id: string, params?: Record<string, unknown>): void;
  };
}

export type PluginDisposer = () => void;

/**
 * Mounts plugin UI into a host-provided element. The plugin chooses its own renderer; the host
 * unmounts the element and calls the returned disposer. A plugin must not assume Vue.
 */
export interface PanelRegistration {
  id: string;
  mount(
    container: HTMLElement,
    context: PluginViewContext,
  ): DisposableLike | Promise<DisposableLike>;
}

export interface TabRegistration {
  id: string;
  mount(
    container: HTMLElement,
    context: PluginViewContext,
  ): DisposableLike | Promise<DisposableLike>;
}

export type ThemeSettingsValues = Record<string, string | number>;

export interface ThemeSettingsContext {
  /** Aborted when the widget is replaced, closed or the plugin is disabled. */
  signal: AbortSignal;
  assetUrl(this: void, relative: string): string;
  /** Current values and defaults for this theme, identified by its declared field IDs. */
  getValues(): Readonly<ThemeSettingsValues>;
  /** Saves a partial update for this theme and immediately applies accepted values. */
  save(values: ThemeSettingsValues): Promise<Readonly<ThemeSettingsValues>>;
}

export interface ThemeSettingsRegistration {
  /** Local ID of a theme with settings declared in the plugin manifest. */
  id: string;
  mount(
    this: void,
    container: HTMLElement,
    context: ThemeSettingsContext,
  ): DisposableLike | Promise<DisposableLike>;
}

export interface ThemeSettingsApi {
  register(contribution: ThemeSettingsRegistration): Disposable;
}

export interface CommandRegistration {
  /** Full command id: use `api.commands.prefix + "format"`. */
  id: string;
  title: string;
  description: string;
  arguments?: Record<string, string>;
  run(args?: unknown): unknown;
}

export interface LanguageApi {
  register(contribution: LanguageRegistration): Disposable;
}

export interface PanelApi {
  register(contribution: PanelRegistration): Disposable;
}

export interface TabApi {
  register(contribution: TabRegistration): Disposable;
}

export interface CommandApi {
  /** Package-owned namespace, including the final dot. */
  readonly prefix: string;
  register(contribution: CommandRegistration): Disposable;
}

/** One item of the agent's own task list, as the chat pins and shows it. */
export interface AgentPlanItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  active?: string;
}

/** A tool call a plan reader may recognize. */
export interface AgentPlanCall {
  name: string;
  input?: string;
}

/**
 * Reads one tool call as a task list: `undefined` when the call does not carry one, `[]` when the
 * agent cleared the list.
 */
export type AgentPlanReader = (call: AgentPlanCall) => AgentPlanItem[] | undefined;

export interface AgentToolCallInfo {
  name: string;
  input?: string;
  kind?: string;
}

export type AgentUsageTone = "spare" | "normal" | "hot" | "over";

export interface AgentUsageMountContext {
  agentId: string;
  title: string;
  usageUrl?: string;
  device: string;
  signal: AbortSignal;
  assetUrl(relative: string): string;
  commands: {
    run(id: string, args?: unknown): Promise<unknown>;
  };
  publishSummary(remaining: number | null, tone?: AgentUsageTone | null): void;
}

export interface AgentClientRegistration {
  id: string;
  plan?: AgentPlanReader;
  mountUsage?(
    container: HTMLElement,
    context: AgentUsageMountContext,
  ): DisposableLike | Promise<DisposableLike>;
  toolLabel?(call: AgentToolCallInfo): string | undefined;
}

export interface AgentClientApi {
  register(contribution: AgentClientRegistration): Disposable;
}

/**
 * Package-scoped key-value state kept on disk by the device that owns the package. Values are
 * plain JSON; all keys of one package share a 1 MB quota. Storage survives disabling and version
 * changes and is removed together with a managed installation.
 */
export interface PluginStorageApi {
  /** `undefined` when the key was never written. */
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export interface PluginApi {
  readonly apiVersion: PluginApiVersion;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly device: string;
  /** URL relative to the browser entry directory; relative paths only. */
  assetUrl(relative: string): string;
  readonly languages: LanguageApi;
  readonly panels: PanelApi;
  readonly tabs: TabApi;
  readonly themeSettings: ThemeSettingsApi;
  readonly commands: CommandApi;
  readonly agents: AgentClientApi;
  readonly storage: PluginStorageApi;
  /**
   * Device-aware URL under this package's `/api/plugins/<key>/` prefix. The server matches the
   * path against the declared routes; a missing route answers 404.
   */
  httpUrl(path: string): string;
  /** Registers cleanup of this activation scope. */
  onDispose(dispose: PluginDisposer): void;
  readonly signal: AbortSignal;
}

export interface Plugin {
  apiVersion: PluginApiVersion;
  activate(api: PluginApi): DisposableLike | Promise<DisposableLike>;
}

/** Identity helper for editors and examples; the runtime also accepts a plain object. */
export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}
