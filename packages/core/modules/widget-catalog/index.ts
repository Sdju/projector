/**
 * What a chat component is, said once. Each component registers a definition next to its
 * implementation; the catalog turns the registered definitions into the instructions an agent
 * gets about them, so the prompt cannot drift from what the client can actually render.
 */
export interface WidgetProp {
  /** `string`, `number`, `boolean`, `array`, `object` or a short shape such as `[{label,value}]`. */
  type: string;
  description: string;
  required?: boolean;
}

export interface WidgetDefinition {
  /** The PascalCase tag the agent writes. */
  name: string;
  /** Where it sits in the guide. */
  group: "layout" | "data" | "form" | "action" | "project";
  /** One line: what it shows or does. */
  summary: string;
  props?: Record<string, WidgetProp>;
  /** Present when the component binds a value with `v-model`. */
  model?: { type: string; description: string };
  /** What goes inside the tag, if anything. */
  slot?: string;
  /** Extra rules worth the agent's tokens (behaviour that is not obvious from the props). */
  notes?: string[];
  /**
   * Rare components stay in the guide as a name and a use case only. Their properties and example
   * come from the `describe_widget` tool on demand, so a large catalogue does not tax every answer.
   */
  special?: boolean;
  /**
   * The block can be the chat's next answer: when an answer ends with it, the composer shows it in
   * place of the text field, and the user's message keeps the same block as a read-only snapshot.
   */
  answer?: boolean;
  /** A minimal working use, included in the guide and detailed description. */
  example: string;
}

/**
 * A widget a project defines for itself. It is a normal definition plus the Vue template the client
 * compiles at runtime, so the project does not need its own build step. The file must be trusted by
 * hash before the template is used or the script is run.
 */
export interface ProjectWidgetDefinition extends WidgetDefinition {
  /** Vue template made of the built-in widgets and ordinary HTML/SVG. */
  template: string;
  /**
   * Body of a function run once after the widget's data is loaded. It gets `ref`, `reactive`,
   * `computed`, `watch`, `onMounted`, `reply`, `props`, `data`, `dataErrors`, `dataLoading` and
   * `dataError`; it may end with `return { … }` to expose values to the template.
   */
  script?: string;
  /** CSS injected once for this widget; selectors are scoped to its wrapper. */
  styles?: string;
  /** Project-relative JSON files exposed to the template as `data.<key>`. */
  data?: Record<string, string>;
  /** Re-read the data files every N seconds; 0 or absent means once per mount. */
  refresh?: number;
}

/** Names the code owns; a project widget cannot shadow one. */
export const BUILTIN_WIDGET_NAMES = [
  "Bars",
  "Button",
  "Card",
  "Checks",
  "Chips",
  "Columns",
  "Donut",
  "Form",
  "GitInfo",
  "Image",
  "InlineIcon",
  "Input",
  "IntelligentForm",
  "Line",
  "Row",
  "Slider",
  "Stat",
  "Steps",
  "Tab",
  "Tabs",
] as const;

const BUILTIN_NAMES = new Set<string>(BUILTIN_WIDGET_NAMES);

export const PROJECT_WIDGET_LIMITS = {
  widgets: 40,
  name: 40,
  summary: 300,
  props: 24,
  description: 400,
  notes: 10,
  note: 400,
  example: 4_000,
  template: 40_000,
  script: 20_000,
  styles: 20_000,
  data: 8,
  dataKey: 40,
  dataPath: 300,
  refresh: 3_600,
} as const;

const WIDGET_NAME = /^[A-Z][A-Za-z0-9]{1,39}$/;
const PROP_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const DATA_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const RESERVED = new Set(["__proto__", "constructor", "prototype"]);
const PROP_TYPE = /^[a-z]+(\s*\|\s*[a-z]+)*$/;
const PROP_TYPES = new Set(["string", "number", "boolean", "array", "object"]);

/** A project-relative file that cannot climb out of the project. */
function safeDataPath(value: string): boolean {
  if (!value || value.length > PROJECT_WIDGET_LIMITS.dataPath) return false;
  if (value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(value))
    return false;
  return !value.split(/[\\/]/).includes("..");
}

function normalizeProps(value: unknown): Record<string, WidgetProp> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const props: Record<string, WidgetProp> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(
    0,
    PROJECT_WIDGET_LIMITS.props,
  )) {
    const name = key.trim();
    if (
      !PROP_NAME.test(name) ||
      RESERVED.has(name) ||
      !item ||
      typeof item !== "object" ||
      Array.isArray(item)
    )
      continue;
    const row = item as Record<string, unknown>;
    const type = typeof row.type === "string" ? row.type.trim() : "";
    if (!PROP_TYPE.test(type)) continue;
    if (!type.split("|").every((part) => PROP_TYPES.has(part.trim()))) continue;
    const description =
      typeof row.description === "string"
        ? row.description.trim().slice(0, PROJECT_WIDGET_LIMITS.description)
        : "";
    if (!description) continue;
    props[name] = {
      type,
      description,
      ...(row.required === true ? { required: true } : {}),
    };
  }
  return Object.keys(props).length ? props : undefined;
}

function normalizeNotes(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const notes = value
    .slice(0, PROJECT_WIDGET_LIMITS.notes)
    .flatMap((item) =>
      typeof item === "string" && item.trim()
        ? [item.trim().slice(0, PROJECT_WIDGET_LIMITS.note)]
        : [],
    );
  return notes.length ? notes : undefined;
}

function normalizeData(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const data: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(
    0,
    PROJECT_WIDGET_LIMITS.data,
  )) {
    const name = key.trim();
    if (!DATA_KEY.test(name) || RESERVED.has(name) || typeof item !== "string") continue;
    const path = item.trim();
    if (!safeDataPath(path)) continue;
    data[name] = path;
  }
  return Object.keys(data).length ? data : undefined;
}

/** The components a template may use: the built-ins and its sibling project widgets. */
function templateIsAllowed(template: string, allowed: ReadonlySet<string>): boolean {
  if (/<script\b/i.test(template) || /<style\b/i.test(template)) return false;
  for (const match of template.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g))
    if (!allowed.has(match[1]!)) return false;
  return true;
}

/**
 * Validates one project widget from `.projector/widgets.json`. `siblings` are the other names in
 * the same file: a template may compose them, but cannot name an arbitrary component.
 */
export function normalizeProjectWidget(
  value: unknown,
  siblings: readonly string[] = [],
): ProjectWidgetDefinition | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!WIDGET_NAME.test(name) || BUILTIN_NAMES.has(name)) return undefined;
  const summary =
    typeof row.summary === "string"
      ? row.summary.trim().slice(0, PROJECT_WIDGET_LIMITS.summary)
      : "";
  if (!summary) return undefined;
  const template = typeof row.template === "string" ? row.template.trim() : "";
  if (!template || template.length > PROJECT_WIDGET_LIMITS.template) return undefined;
  const allowed = new Set<string>([...BUILTIN_WIDGET_NAMES, ...siblings.filter((n) => n !== name)]);
  if (!templateIsAllowed(template, allowed)) return undefined;
  const script = typeof row.script === "string" ? row.script.trim() : "";
  if (script.length > PROJECT_WIDGET_LIMITS.script) return undefined;
  const styles = typeof row.styles === "string" ? row.styles.trim() : "";
  if (styles.length > PROJECT_WIDGET_LIMITS.styles) return undefined;
  const notes = normalizeNotes(row.notes);
  const props = normalizeProps(row.props);
  const data = normalizeData(row.data);
  const example =
    typeof row.example === "string" && row.example.trim()
      ? row.example.trim().slice(0, PROJECT_WIDGET_LIMITS.example)
      : `<${name} />`;
  const refreshValue = Number(row.refresh);
  const refresh =
    Number.isInteger(refreshValue) && refreshValue >= 5
      ? Math.min(refreshValue, PROJECT_WIDGET_LIMITS.refresh)
      : undefined;
  return {
    name,
    group: "project",
    summary,
    ...(props ? { props } : {}),
    ...(notes ? { notes } : {}),
    ...(row.special === true ? { special: true } : {}),
    ...(row.answer === true && /<(IntelligentForm|Form)\b/.test(template) ? { answer: true } : {}),
    template,
    ...(script ? { script } : {}),
    ...(styles ? { styles } : {}),
    ...(data ? { data } : {}),
    ...(refresh !== undefined ? { refresh } : {}),
    example,
  };
}

/** Project widgets read from `.projector/widgets.json`; they are inert until the file is trusted. */
export interface ProjectWidgetState {
  projectId: string;
  /** Real folder of the project, the key of the trust decision. */
  path: string;
  file: string;
  exists: boolean;
  trusted: boolean;
  hash?: string;
  widgets: ProjectWidgetDefinition[];
  /** Why the file could not be read or is unsafe; widgets stay empty. */
  problem?: string;
}

/** Values the data files of one widget gave the client. */
export interface ProjectWidgetData {
  data: Record<string, unknown>;
  errors: Record<string, string>;
}

/** Identity helper: gives the object literal its type. */
export const defineWidget = (definition: WidgetDefinition): WidgetDefinition => definition;

const GROUPS: Record<WidgetDefinition["group"], string> = {
  layout: "Раскладка",
  data: "Данные",
  form: "Форма и ввод",
  action: "Действия",
  project: "Виджеты проекта",
};

/** Metadata stays in prose; only the example contains copyable Vue markup. */
function describeDefinition(definition: WidgetDefinition): string[] {
  const props = Object.entries(definition.props ?? {}).map(
    ([name, prop]) =>
      `  ${name}: ${prop.type}; ${prop.required ? "обязательное" : "необязательное"} — ${prop.description}`,
  );
  return [
    `${definition.name} — ${definition.summary}`,
    ...(definition.slot ? [`Содержимое: ${definition.slot}`] : []),
    ...(definition.model
      ? [`v-model: ${definition.model.type} — ${definition.model.description}`]
      : []),
    ...(props.length ? ["Свойства:", ...props] : []),
    ...(definition.notes ?? []),
    ...(definition.answer
      ? [
          "Форма ответа: если ответ заканчивается этим блоком, композер показывает его вместо поля ввода и сохраняет отправленные значения.",
        ]
      : []),
    "Пример Vue-разметки:",
    "```vue",
    definition.example,
    "```",
  ];
}

export const WIDGET_SYNTAX = [
  "Используй только компоненты из каталога ниже. Каждый блок начинается сразу с зарегистрированного компонента; дополнительная обёртка не нужна. Обычные HTML- и SVG-элементы разрешены внутри блока.",
  "Типы и обязательность свойств описаны отдельно от примеров: эти пояснения не входят в Vue-разметку. Необязательное свойство можно просто опустить.",
  'Числа передавай через привязку с десятичной точкой, без единиц и знака процента: например, :delta="3.6". Компонент сам добавляет процент к delta. Строки передавай обычным атрибутом, например value="3,6%", если нужен текст показателя.',
  "В ответе пиши Vue-разметку с новой строки прямо в markdown, без кодового блока. Примеры в справке выделены кодовыми блоками только для чтения. Корневой тег должен быть закрыт или самозакрыт. Массивы и объекты передавай через привязки свойств, как в примерах ниже. Булев флаг можно включить атрибутом без значения. Внутри блока — HTML и Vue-шаблон; для жирного текста используй элемент strong.",
  'Для расчётов, где значения зависят друг от друга, добавь <script>: в нём есть ref, reactive, computed, watch, onMounted и reply(данные, "подпись"); верни из него объект со всем, что нужно шаблону. Например, тело скрипта: const n = ref(1); return { n }; <script> между блоками один на весь ответ: его значения видны во всех блоках (ползунок в одном управляет графиком в другом), порядок не важен; <script> внутри блока виден только ему.',
  "Данные бери из фактов, которые проверил сам; не выдумывай цифры.",
];

export interface WidgetCatalog {
  /** Registering a name again replaces it. */
  register(definition: WidgetDefinition): void;
  has(name: string): boolean;
  get(name: string): WidgetDefinition | undefined;
  list(): WidgetDefinition[];
  /** The instructions for the agent: syntax rules, properties and working examples, grouped. */
  guide(): string;
  /** The project's own widgets appended to the guide; syntax rules are not repeated. */
  extraGuide(extra: readonly WidgetDefinition[]): string;
  /** Everything about one component: props with types, notes and an example. */
  describe(name: string, extra?: readonly WidgetDefinition[]): string;
  /** The same, but only for a special component; normal ones are already in the guide. */
  describeSpecial(name: string, extra?: readonly WidgetDefinition[]): string;
}

function groupSections(definitions: readonly WidgetDefinition[]): string[] {
  return (Object.keys(GROUPS) as WidgetDefinition["group"][])
    .map((group) => {
      const lines = definitions
        .filter((definition) => definition.group === group && !definition.special)
        .flatMap((definition) => [...describeDefinition(definition), ""]);
      return lines.length ? `${GROUPS[group]}:\n${lines.join("\n")}` : "";
    })
    .filter(Boolean);
}

function specialSection(
  definitions: readonly WidgetDefinition[],
  title = "Специальные виджеты",
): string {
  const special = definitions.filter((definition) => definition.special);
  return special.length
    ? [
        `${title}:`,
        "Их свойства и примеры не загружены. Когда специальный виджет уместен, сначала вызови describe_widget с его именем; не угадывай свойства.",
        ...special.map((definition) => `${definition.name} — ${definition.summary}`),
      ].join("\n")
    : "";
}

/** The guide of extra definitions alone, for a project's widgets appended to the built-in one. */
export function renderWidgetGuide(
  definitions: readonly WidgetDefinition[],
  specialTitle = "Специальные виджеты проекта",
): string {
  return [...groupSections(definitions), specialSection(definitions, specialTitle)]
    .filter(Boolean)
    .join("\n");
}

export function createWidgetCatalog(): WidgetCatalog {
  const items = new Map<string, WidgetDefinition>();
  const list = () => [...items.values()];
  const find = (name: string, extra: readonly WidgetDefinition[] = []) =>
    extra.find((definition) => definition.name === name) ?? items.get(name);
  return {
    register: (definition) => void items.set(definition.name, definition),
    has: (name) => items.has(name),
    get: (name) => items.get(name),
    list,
    guide() {
      const sections = groupSections(list());
      return [WIDGET_SYNTAX.join("\n"), ...sections, specialSection(list())]
        .filter(Boolean)
        .join("\n");
    },
    extraGuide(extra) {
      return renderWidgetGuide(extra);
    },
    describe(name, extra = []) {
      const definition = find(name, extra);
      if (!definition) return `Нет компонента ${name}`;
      return describeDefinition(definition).join("\n");
    },
    describeSpecial(name, extra = []) {
      const definition = find(name, extra);
      if (!definition) throw new Error(`Нет компонента ${name}`);
      if (!definition.special)
        throw new Error(`Компонент ${name} не специальный: его описание уже есть в промпте`);
      return describeDefinition(definition).join("\n");
    },
  };
}
