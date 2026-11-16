import { expect, test } from "vite-plus/test";
import { effectScope, nextTick, ref } from "vue";
import { useStartPreset } from "../modules/agent/model/start-preset.ts";

const form = '<IntelligentForm><Field name="scope" label="Что проверить" /></IntelligentForm>';
const preset = {
  id: "preset-project",
  title: "Ревью",
  prompt: "Проверь изменения.",
  form,
  source: "project",
};

function setup() {
  const turns = ref([]);
  const chat = ref("chat-1");
  const pendingForm = ref();
  const sent = [];
  const answers = [];
  const scope = effectScope();
  const start = scope.run(() =>
    useStartPreset({
      turns,
      chat: () => chat.value,
      pendingForm,
      send: async (text, chips, options) => sent.push({ text, chips, options }),
      submitAnswerForm: (text, data, summary, source) =>
        answers.push({ text, data, summary, source }),
      toBottom: () => {},
    }),
  );
  return { turns, chat, pendingForm, sent, answers, start, scope };
}

test("a starter preset form replaces the composer and sends with its prompt", () => {
  const { start, sent, scope } = setup();
  expect(start.form.value).toBeUndefined();

  start.open(preset);
  expect(start.form.value).toBe(form);

  start.submit("весь diff", { scope: "весь diff" }, "Ревью", form);
  expect(start.form.value).toBeUndefined();
  expect(sent).toEqual([
    {
      text: "Проверь изменения.\n\nвесь diff",
      chips: undefined,
      options: { form: { source: form, values: { scope: "весь diff" }, summary: "Ревью" } },
    },
  ]);
  scope.stop();
});

test("an answer form keeps the usual answer pipeline", () => {
  const { start, pendingForm, sent, answers, scope } = setup();
  pendingForm.value = form;

  start.submit("да", { scope: "staged" }, undefined, form);
  expect(answers).toEqual([
    { text: "да", data: { scope: "staged" }, summary: undefined, source: form },
  ]);
  expect(sent).toEqual([]);
  scope.stop();
});

test("a starter preset form closes when the chat or its messages change", async () => {
  const { start, chat, turns, pendingForm, scope } = setup();
  pendingForm.value = "<Form />";

  start.open(preset);
  expect(start.form.value).toBe(form);
  chat.value = "chat-2";
  await nextTick();
  expect(start.form.value).toBe("<Form />");

  start.open(preset);
  turns.value = [{ id: "u1", role: "user", text: "привет", tools: [] }];
  await nextTick();
  expect(start.form.value).toBe("<Form />");
  scope.stop();
});
