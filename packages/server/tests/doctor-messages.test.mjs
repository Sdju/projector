import { expect, test } from "vite-plus/test";
import { doctorMessages } from "../modules/agents/projector/doctor-messages.ts";

const opening = {
  kind: "answer",
  original: "<Card>### Сломано</Card>",
  originalError: "Card: внутри виджета остался Markdown",
  error: "Card: внутри виджета остался Markdown",
  history: "Пользователь: сделай отчёт",
  attempt: 1,
  limit: 3,
};

test("the first doctor request carries the history and the original text", () => {
  const messages = doctorMessages(opening);
  expect(messages).toHaveLength(1);
  expect(messages[0].role).toBe("user");
  expect(messages[0].content).toContain("сделай отчёт");
  expect(messages[0].content).toContain("<Card>### Сломано</Card>");
  expect(messages[0].content).toContain("Card: внутри виджета остался Markdown");
  expect(messages[0].content).toContain("Верни весь исправленный ответ");
});

test("a retry continues the same round with the doctor's own reply", () => {
  const messages = doctorMessages({
    ...opening,
    attempt: 2,
    error: "Card: всё ещё Markdown",
    previous: "<Card><h3>Готово</h3></Card>",
  });
  expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
  expect(messages[1].content).toBe("<Card><h3>Готово</h3></Card>");
  expect(messages[2].content).toContain("попытка 2 из 3");
  expect(messages[2].content).toContain("Не начинай заново");
  expect(messages[2].content).toContain("Card: всё ещё Markdown");
  expect(messages[2].content).toContain("PROJECTOR-DOCTOR: VALID");
});

test("a form round names the form and its compiler error", () => {
  const [message] = doctorMessages({
    ...opening,
    kind: "form",
    original: '<Form><Input name="a" /></Form>',
    originalError: "Duplicate attribute",
    error: "Duplicate attribute",
  });
  expect(message.content).toContain("Ошибочная форма");
  expect(message.content).toContain("Ошибка компилятора");
  expect(message.content).toContain("Верни исправленную форму");
});
