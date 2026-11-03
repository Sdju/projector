import { defineWidget } from "../../widget-catalog/index.ts";

export const inputWidget = defineWidget({
  name: "Input",
  group: "form",
  summary: "строка или многострочный текст",
  props: {
    label: { type: "string", description: "подпись" },
    placeholder: { type: "string", description: "подсказка в пустом поле" },
    multiline: { type: "boolean", description: "несколько строк" },
    name: { type: "string", description: "имя поля в <Form>" },
    initial: { type: "string", description: "начальный текст" },
  },
  model: { type: "string", description: "введённый текст" },
  example: '<Input name="note" label="Комментарий" multiline />',
});
