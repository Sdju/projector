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
  group: "layout" | "data" | "form" | "action";
  /** One line: what it shows or does. */
  summary: string;
  props?: Record<string, WidgetProp>;
  /** Present when the component binds a value with `v-model`. */
  model?: { type: string; description: string };
  /** What goes inside the tag, if anything. */
  slot?: string;
  /** Extra rules worth the agent's tokens (behaviour that is not obvious from the props). */
  notes?: string[];
  /** A minimal working use, shown by `describe`. */
  example: string;
}

/** Identity helper: gives the object literal its type. */
export const defineWidget = (definition: WidgetDefinition): WidgetDefinition => definition;

const GROUPS: Record<WidgetDefinition["group"], string> = {
  layout: "Раскладка",
  data: "Данные",
  form: "Форма и ввод",
  action: "Действия",
};

/** Written as an attribute, not an expression: `label="…"`, `submit`. */
const attributeTypes = new Set(["string", "boolean"]);

/** `label` or `:delta?`: props other than strings and flags are written as expressions, optional ones end in `?`. */
function signature(definition: WidgetDefinition): string {
  const props = Object.entries(definition.props ?? {}).map(([name, prop]) => {
    const bound = attributeTypes.has(prop.type) ? name : `:${name}`;
    return prop.required ? bound : `${bound}?`;
  });
  if (definition.model) props.push(`v-model`);
  return [definition.name, ...props].join(" ");
}

export const WIDGET_SYNTAX = [
  'Блок начинается с новой строки тегом в PascalCase и закрыт им же (или самозакрыт). Строки пишутся как есть, всё остальное через :prop="выражение JS". Внутри — HTML и Vue-шаблон, а не markdown (жирный — <strong>).',
  'Для расчётов, где значения зависят друг от друга, добавь <script>: в нём есть ref, reactive, computed, watch, onMounted и reply(данные, "подпись"); он заканчивается return { … } со всем, что нужно шаблону. <script> между блоками один на весь ответ: его значения видны во всех блоках (ползунок в одном управляет графиком в другом), порядок не важен; <script> внутри блока виден только ему.',
  "Данные бери из фактов, которые проверил сам; не выдумывай цифры.",
];

export interface WidgetCatalog {
  /** Registering a name again replaces it. */
  register(definition: WidgetDefinition): void;
  has(name: string): boolean;
  get(name: string): WidgetDefinition | undefined;
  list(): WidgetDefinition[];
  /** The instructions for the agent: syntax rules and one line per component, grouped. */
  guide(): string;
  /** Everything about one component: props with types, notes and an example. */
  describe(name: string): string;
}

export function createWidgetCatalog(): WidgetCatalog {
  const items = new Map<string, WidgetDefinition>();
  const list = () => [...items.values()];
  return {
    register: (definition) => void items.set(definition.name, definition),
    has: (name) => items.has(name),
    get: (name) => items.get(name),
    list,
    guide() {
      const sections = (Object.keys(GROUPS) as WidgetDefinition["group"][])
        .map((group) => {
          const lines = list()
            .filter((definition) => definition.group === group)
            .flatMap((definition) => [
              `- <${signature(definition)}> — ${definition.summary}`,
              ...(definition.notes ?? []).map((note) => `  ${note}`),
            ]);
          return lines.length ? `${GROUPS[group]}:\n${lines.join("\n")}` : "";
        })
        .filter(Boolean);
      return [WIDGET_SYNTAX.join("\n"), ...sections].join("\n");
    },
    describe(name) {
      const definition = items.get(name);
      if (!definition) return `Нет компонента ${name}`;
      const props = Object.entries(definition.props ?? {}).map(
        ([key, prop]) => `  ${key}${prop.required ? "" : "?"}: ${prop.type} — ${prop.description}`,
      );
      return [
        `<${signature(definition)}> — ${definition.summary}`,
        ...(definition.slot ? [`Внутри: ${definition.slot}`] : []),
        ...(definition.model
          ? [`v-model: ${definition.model.type} — ${definition.model.description}`]
          : []),
        ...(props.length ? ["Свойства:", ...props] : []),
        ...(definition.notes ?? []),
        "Пример:",
        definition.example,
      ].join("\n");
    },
  };
}
