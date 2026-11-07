import { expect, test, vi } from "vite-plus/test";
import { effectScope, ref } from "vue";

vi.mock("../packages/client/modules/agent/api/client.ts", () => ({ repairAnswer: vi.fn() }));

const { repairAnswer } = await import("../packages/client/modules/agent/api/client.ts");
const { useAnswerDoctor } = await import("../packages/client/modules/agent/model/answer-doctor.ts");
const { answerProblem, doctorAnswerSource } =
  await import("../packages/client/modules/widget-runtime/repair.ts");
const { cardWidget } = await import("../packages/core/modules/agent-widgets/card/index.ts");
const { registerWidget } = await import("../packages/client/modules/widget-runtime/registry.ts");

registerWidget({ definition: cardWidget, component: { render: () => null } });

const ask = (text) => ({
  turns: ref([{ id: "assistant", role: "assistant", text, tools: [], at: Date.now() }]),
  busy: ref(false),
  selection: ref({}),
  persist: vi.fn(),
});

async function waitFor(check, ms = 3000) {
  for (let waited = 0; waited < ms; waited += 25) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(await check()).toBeTruthy();
}

test("Answer Doctor leaves ordinary Markdown alone", async () => {
  repairAnswer.mockReset();
  const options = ask("### Заголовок\n\n**Обычный** ответ с `кодом`.");
  const scope = effectScope();
  scope.run(() => useAnswerDoctor(options));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(await answerProblem(options.turns.value[0].text)).toBeUndefined();
  expect(repairAnswer).not.toHaveBeenCalled();
  expect(options.persist).not.toHaveBeenCalled();
  scope.stop();
  expect(await answerProblem("```vue\n<Card>\n```")).toBeUndefined();
  expect(await answerProblem("Текст\n<Card>\nНезакрыто")).toContain("Незакрытый");
});

test("Answer Doctor saves the repair and does not run again after reload", async () => {
  repairAnswer.mockReset();
  const broken =
    "<Card>\n### Контракт\n\n| Слой | Что |\n| --- | --- |\n| UI | **Панель** |\n</Card>";
  const fixed =
    "<Card><h3>Контракт</h3><table><tbody><tr><td>UI</td><td><strong>Панель</strong></td></tr></tbody></table></Card>";
  repairAnswer.mockResolvedValueOnce(fixed);
  const options = ask(broken);
  options.turns.value[0].parts = [
    { type: "text", text: broken },
    { type: "tool", id: "tool" },
    { type: "text", text: "Старый хвост" },
  ];
  const scope = effectScope();
  scope.run(() => useAnswerDoctor(options));
  await waitFor(() => options.turns.value[0].text === fixed);
  expect(repairAnswer).toHaveBeenCalledTimes(1);
  expect(repairAnswer.mock.calls[0][0].answer).toBe(broken);
  expect(repairAnswer.mock.calls[0][0].error).toContain("Markdown");
  expect(options.persist).toHaveBeenCalledTimes(1);
  expect(options.turns.value[0].parts).toEqual([
    { type: "text", text: fixed },
    { type: "tool", id: "tool" },
  ]);
  scope.stop();

  const reloaded = ask(options.turns.value[0].text);
  const reloadedScope = effectScope();
  reloadedScope.run(() => useAnswerDoctor(reloaded));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(repairAnswer).toHaveBeenCalledTimes(1);
  expect(reloaded.persist).not.toHaveBeenCalled();
  reloadedScope.stop();
});

test("Answer Doctor validates each attempt and accepts a fenced answer", async () => {
  repairAnswer.mockReset();
  repairAnswer
    .mockResolvedValueOnce("<Card>### Всё ещё Markdown</Card>")
    .mockResolvedValueOnce("```markdown\n<Card><h3>Готово</h3></Card>\n```");
  const options = ask("<Card>### Сломано</Card>");
  const scope = effectScope();
  scope.run(() => useAnswerDoctor(options));
  await waitFor(() => options.turns.value[0].text === "<Card><h3>Готово</h3></Card>");
  expect(repairAnswer).toHaveBeenCalledTimes(2);
  expect(repairAnswer.mock.calls[1][0].answer).toContain("Всё ещё");
  expect(options.persist).toHaveBeenCalledTimes(1);
  expect(doctorAnswerSource("  \n```text\nГотово\n```\n")).toBe("Готово");
  scope.stop();
});
