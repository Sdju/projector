import { defineWidget } from "../../widget-catalog/index.ts";

export const rowWidget = defineWidget({
  name: "Row",
  group: "layout",
  summary: "ряд с переносом по ширине (показатели кладут в него)",
  props: {
    gap: { type: "number", description: "отступ в пикселях" },
  },
  slot: "элементы ряда",
  example: '<Row><Stat label="A" value="1" /><Stat label="B" value="2" /></Row>',
});
