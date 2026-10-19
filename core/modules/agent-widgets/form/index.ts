import { defineWidget } from "../../widget-catalog/index.ts";

export const formWidget = defineWidget({
  name: "Form",
  group: "form",
  summary: "форма без скрипта: собирает именованные поля внутри",
  slot: "поля с name и кнопки",
  notes: [
    "Поля внутри — Checks, Input, Slider и Tabs в режиме переключателя. Укажи полю name; начальное значение можно задать свойством initial. У Button флаг submit отправляет значения полей тебе и блокирует форму, summary задаёт подпись ответа, reset возвращает исходные значения, а preset принимает объект с новыми значениями полей.",
    "Когда нужен выбор или настройки пользователя: покажи форму с submit-кнопкой и остановись; действуй после его ответа и только по выбранному.",
  ],
  example:
    '<Form><Checks name="scripts" :options="[\'start\',\'test\']" /><Button submit summary="Выбор">Применить</Button></Form>',
});
