import type { WidgetDefinition } from "./index.ts";

const GROUPS: Record<WidgetDefinition["group"], string> = {
  layout: "Раскладка",
  data: "Данные",
  form: "Форма и ввод",
  action: "Действия",
  project: "Виджеты проекта",
};

/** Metadata stays in prose; only the example contains copyable Vue markup. */
export function describeDefinition(definition: WidgetDefinition): string[] {
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

/** What the permanent guide says about one widget: a compact entry or the full description. */
export function guideDefinition(definition: WidgetDefinition): string[] {
  if (!definition.guide) return describeDefinition(definition);
  return [
    `${definition.name} — ${definition.summary}`,
    ...definition.guide.split("\n"),
    "Пример Vue-разметки:",
    "```vue",
    definition.example,
    "```",
  ];
}

export function groupSections(definitions: readonly WidgetDefinition[]): string[] {
  return (Object.keys(GROUPS) as WidgetDefinition["group"][])
    .map((group) => {
      const lines = definitions
        .filter(
          (definition) => definition.group === group && !definition.special && !definition.hidden,
        )
        .flatMap((definition) => [...guideDefinition(definition), ""]);
      return lines.length ? `${GROUPS[group]}:\n${lines.join("\n")}` : "";
    })
    .filter(Boolean);
}

export function specialSection(
  definitions: readonly WidgetDefinition[],
  title = "Специальные виджеты",
): string {
  const special = definitions.filter((definition) => definition.special && !definition.hidden);
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
