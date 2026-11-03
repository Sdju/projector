import { defineWidget } from "../../widget-catalog/index.ts";

export const cardWidget = defineWidget({
  name: "Card",
  group: "layout",
  summary: "рамка с заголовком для группы",
  props: {
    title: { type: "string", description: "заголовок" },
    hint: { type: "string", description: "подпись под заголовком" },
    tone: { type: "'neutral' | 'warning'", description: "цвет рамки" },
  },
  slot: "содержимое рамки",
  example: '<Card title="Итоги" hint="за квартал">Выручка выросла на 12%.</Card>',
});
