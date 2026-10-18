import { defineWidget } from "../../widget-catalog/index.ts";

export const buttonWidget = defineWidget({
  name: "Button",
  group: "action",
  summary: "кнопка; отправляет данные агенту только по клику пользователя",
  props: {
    submit: { type: "boolean", description: "отправить значения окружающей <Form>" },
    reset: { type: "boolean", description: "вернуть поля формы к исходным" },
    preset: { type: "object", description: "задать поля формы по имени: {поле: значение}" },
    send: { type: "string | object", description: "отправить это агенту как есть (вне формы)" },
    summary: { type: "string", description: "строка перед данными в сообщении" },
    sentLabel: { type: "string", description: "подпись после отправки, по умолчанию «Отправлено»" },
  },
  slot: "подпись кнопки",
  notes: [
    "После отправки кнопка и форма блокируются. Без submit/send/preset/reset это обычная кнопка с @click.",
  ],
  example: '<Button send="Да, продолжай" summary="Ответ">Продолжить</Button>',
});
