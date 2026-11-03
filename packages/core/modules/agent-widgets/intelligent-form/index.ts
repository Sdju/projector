import { defineWidget } from "../../widget-catalog/index.ts";

export const intelligentFormWidget = defineWidget({
  name: "IntelligentForm",
  group: "form",
  summary: "форма ответа: поля управления; в поле ввода отправляется общей кнопкой",
  answer: true,
  props: {
    submit: {
      type: "string",
      description: "подпись кнопки в сообщении или снимке, по умолчанию «Отправить»",
    },
    summary: {
      type: "string",
      description: "строка перед данными в сообщении агенту",
    },
    sentLabel: {
      type: "string",
      description: "подпись кнопки после отправки, по умолчанию «Отправлено»",
    },
  },
  slot: "поля с name: Checks, Input, Slider и Tabs",
  notes: [
    "Когда нужно собрать два параметра или больше либо настройки пользователя, закончи ответ одной IntelligentForm и не пиши текст после неё; не разделяй их на несколько ask_user. Для одного вопроса или одного варианта остаётся ask_user.",
    "Внутрь положи поля с name. Не оборачивай форму в Card или Form и не добавляй Button submit: в поле ввода отправляет общая кнопка, а в сообщении и снимке — кнопка самой формы.",
    "Пока форма открыта в поле ввода, её блок не показывается в ответе; не дублируй его текстом.",
  ],
  example:
    '<IntelligentForm summary="Настройки проекта" submit="Применить"><Checks name="mode" :options="[\'server\',\'window\']" single /><Input name="port" label="Порт" initial="4177" /></IntelligentForm>',
});
