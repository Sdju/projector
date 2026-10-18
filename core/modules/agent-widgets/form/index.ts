import { defineWidget } from "../../widget-catalog/index.ts";

export const formWidget = defineWidget({
  name: "Form",
  group: "form",
  summary: "форма без скрипта: собирает именованные поля внутри",
  slot: "поля с name и кнопки",
  notes: [
    'Поля внутри — <Checks>, <Input>, <Slider>, <Tabs :options> с атрибутом name (и :initial). Кнопки: <Button submit summary="…"> отправляет значения полей тебе и блокирует форму, <Button reset> возвращает исходные, <Button :preset="{поле: значение}"> задаёт значения.',
    "Когда нужен выбор или настройки пользователя: покажи форму с submit-кнопкой и остановись; действуй после его ответа и только по выбранному.",
  ],
  example:
    '<Form><Checks name="scripts" :options="[\'start\',\'test\']" /><Button submit summary="Выбор">Применить</Button></Form>',
});
