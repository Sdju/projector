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
  /** A minimal working use, included in the guide and detailed description. */
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
            .flatMap((definition) => [...describeDefinition(definition), ""]);
          return lines.length ? `${GROUPS[group]}:\n${lines.join("\n")}` : "";
        })
        .filter(Boolean);
      return [WIDGET_SYNTAX.join("\n"), ...sections].join("\n");
    },
    describe(name) {
      const definition = items.get(name);
      if (!definition) return `Нет компонента ${name}`;
      return describeDefinition(definition).join("\n");
    },
  };
}
