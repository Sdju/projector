import { expect, test } from "vite-plus/test";
import { effectScope, ref } from "vue";
import { answeredFormSources, useAnswerForm } from "../modules/agent/model/answer-form.ts";
import { restoreFormAnswers } from "../modules/agent-core/model/form-reply.ts";
import { intelligentFormWidget } from "../../core/modules/agent-widgets/intelligent-form/index.ts";
import { inputWidget } from "../../core/modules/agent-widgets/input/index.ts";
import { registerWidget } from "../modules/widget-runtime/registry.ts";

registerWidget({ definition: intelligentFormWidget, component: { render: () => null } });
registerWidget({ definition: inputWidget, component: { render: () => null } });

const form = '<IntelligentForm><Input name="next" /></IntelligentForm>';
const turn = (id, role, text, extra = {}) => ({ id, role, text, tools: [], ...extra });
const snapshot = { source: form, values: { next: "да" } };

test("an answered form hides the copy in the answer it came from", () => {
  const turns = [
    turn("a1", "assistant", `Готово\n\n${form}`),
    turn("u1", "user", "ответ", { form: snapshot }),
    turn("a2", "assistant", "Спасибо"),
  ];
  const answered = answeredFormSources(turns);
  expect(answered.get("a1")).toContain(form);
  expect(answered.has("a2")).toBe(false);
});

test("a text reply keeps the answer form instead of hiding it", () => {
  const turns = [
    turn("a1", "assistant", `Готово\n\n${form}`),
    turn("u1", "user", "нет, давай иначе"),
  ];
  expect(answeredFormSources(turns).size).toBe(0);
});

test("a form snapshot does not hide an answer that has no form", () => {
  const turns = [
    turn("a1", "assistant", "Просто текст"),
    turn("u1", "user", "ответ", { form: snapshot }),
  ];
  expect(answeredFormSources(turns).size).toBe(0);
});

test("the chat gives each answer its own form state", () => {
  const turns = ref([
    turn("a1", "assistant", `Готово\n\n${form}`),
    turn("u1", "user", "ответ", { form: snapshot }),
    turn("a2", "assistant", "Спасибо"),
  ]);
  const scope = effectScope();
  const answer = scope.run(() =>
    useAnswerForm({
      turns,
      busy: ref(false),
      draft: ref(""),
      draftParts: ref([]),
      send: async () => {},
      edit: () => {},
    }),
  );
  expect(answer.answerFormFor(turns.value[0])).toEqual({ promotedForm: form, formAnswered: true });
  expect(answer.answerFormFor(turns.value[1])).toEqual({});
  expect(answer.answerFormFor(turns.value[2])).toEqual({});
  scope.stop();
});

test("a native session restores the form snapshot from the reply", async () => {
  const turns = [
    turn("a1", "assistant", `Готово\n\n${form}`),
    turn("u1", "user", 'Проверка\n\n```json\n{\n  "next": "да"\n}\n```'),
  ];
  await restoreFormAnswers(turns);
  expect(turns[1].form).toEqual({
    source: form,
    values: { next: "да" },
    summary: "Проверка",
  });
});

test("a JSON block with other keys does not become a form", async () => {
  const turns = [
    turn("a1", "assistant", `Готово\n\n${form}`),
    turn("u1", "user", '```json\n{"other": 1}\n```'),
  ];
  expect(await restoreFormAnswers(turns)).toBe(0);
  expect(turns[1].form).toBeUndefined();
});

test("a JSON block without an answer form stays text", async () => {
  const turns = [
    turn("a1", "assistant", "Просто текст"),
    turn("u1", "user", '```json\n{"next": "да"}\n```'),
  ];
  expect(await restoreFormAnswers(turns)).toBe(0);
  expect(turns[1].form).toBeUndefined();
});
