import { expect, test, vi } from "vite-plus/test";
import { effectScope, ref } from "vue";

vi.mock("../modules/agent-core/api/client.ts", () => ({ repairAnswer: vi.fn() }));

const { repairAnswer } = await import("../modules/agent-core/api/client.ts");
const { useAnswerDoctor, answerFingerprint } =
  await import("../modules/agent/model/answer-doctor.ts");
const { answerProblem, doctorAnswerSource } = await import("../modules/widget-runtime/repair.ts");
const { cardWidget } = await import("../../core/modules/agent-widgets/card/index.ts");
const { registerWidget } = await import("../modules/widget-runtime/registry.ts");

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
  // `<` is an attribute value or text, not a component.
  expect(await answerProblem('<Card title="impact <Module>">ok</Card>')).toBeUndefined();
  expect(
    await answerProblem("<Card><p><code>a</code> + <code>b</code> + <code>c</code></p></Card>"),
  ).toBeUndefined();
  expect(await answerProblem("<Card><pre>**literal** и `code`</pre></Card>")).toBeUndefined();
  // Real Markdown in a slot still asks for the doctor.
  expect(await answerProblem("<Card>\n- **Node** и `code`\n</Card>")).toContain("Markdown");
});

test("Answer Doctor clears a failure mark when the answer now passes", async () => {
  const text = "<Card><h3>Готово</h3></Card>";
  const options = ask(text);
  options.turns.value[0].doctor = {
    status: "failed",
    attempts: 3,
    problem: "Card: внутри виджета остался Markdown",
    remaining: "Card: всё ещё Markdown",
    took: 20,
    answer: answerFingerprint(text),
    at: Date.now(),
  };
  const scope = effectScope();
  const doctor = scope.run(() => useAnswerDoctor(options));
  await waitFor(() => options.turns.value[0].doctor === undefined);
  expect(options.persist).toHaveBeenCalledTimes(1);
  expect(doctor.reportFor(options.turns.value[0])).toBeUndefined();
  scope.stop();
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
  const doctor = scope.run(() => useAnswerDoctor(options));
  await waitFor(() => options.turns.value[0].text === fixed);
  expect(repairAnswer).toHaveBeenCalledTimes(1);
  expect(repairAnswer.mock.calls[0][0].answer).toBe(broken);
  expect(repairAnswer.mock.calls[0][0].error).toContain("Markdown");
  expect(options.persist).toHaveBeenCalledTimes(1);
  expect(options.turns.value[0].parts).toEqual([
    { type: "text", text: fixed },
    { type: "tool", id: "tool" },
  ]);
  expect(doctor.progress.has("assistant")).toBe(false);
  expect(doctor.reportFor(options.turns.value[0])).toMatchObject({
    status: "fixed",
    attempts: 1,
  });
  expect(options.turns.value[0].doctor?.problem).toContain("Markdown");
  scope.stop();

  const reloaded = ask(options.turns.value[0].text);
  reloaded.turns.value[0] = options.turns.value[0];
  const reloadedScope = effectScope();
  const reloadedDoctor = reloadedScope.run(() => useAnswerDoctor(reloaded));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(repairAnswer).toHaveBeenCalledTimes(1);
  expect(reloaded.persist).not.toHaveBeenCalled();
  expect(reloadedDoctor.reportFor(reloaded.turns.value[0])?.status).toBe("fixed");
  reloadedScope.stop();
});

test("Answer Doctor shows repair progress and counts the attempts", async () => {
  repairAnswer.mockReset();
  let release = () => {};
  repairAnswer.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () => resolve("```markdown\n<Card><h3>Готово</h3></Card>\n```");
      }),
  );
  const options = ask("<Card>### Сломано</Card>");
  const scope = effectScope();
  const doctor = scope.run(() => useAnswerDoctor(options));
  await waitFor(() => doctor.progress.get("assistant")?.status === "repairing");
  expect(doctor.progress.get("assistant")).toMatchObject({
    attempts: 1,
    limit: 3,
  });
  expect(doctor.progress.get("assistant")?.problem).toContain("Markdown");
  expect(options.turns.value[0].doctor).toBeUndefined();
  release();
  await waitFor(() => options.turns.value[0].text === "<Card><h3>Готово</h3></Card>");
  expect(doctor.progress.has("assistant")).toBe(false);
  expect(doctor.reportFor(options.turns.value[0])).toMatchObject({
    status: "fixed",
    attempts: 1,
  });
  // A retry replaces the text: the saved mark must not lie about the new answer.
  expect(doctor.reportFor({ ...options.turns.value[0], text: "Другой ответ" })).toBeUndefined();
  scope.stop();
});

test("Answer Doctor reports a failure and keeps the original answer", async () => {
  repairAnswer.mockReset();
  repairAnswer.mockResolvedValue("<Card>### Всё ещё Markdown</Card>");
  const options = ask("<Card>### Сломано</Card>");
  const scope = effectScope();
  const doctor = scope.run(() => useAnswerDoctor(options));
  await waitFor(() => doctor.progress.get("assistant")?.status === "failed");
  expect(doctor.progress.get("assistant")).toMatchObject({ attempts: 3, limit: 3 });
  expect(doctor.progress.get("assistant")?.remaining).toContain("Markdown");
  expect(repairAnswer).toHaveBeenCalledTimes(3);
  expect(options.turns.value[0].text).toBe("<Card>### Сломано</Card>");
  expect(options.turns.value[0].doctor).toMatchObject({
    status: "failed",
    attempts: 3,
  });
  expect(doctor.reportFor(options.turns.value[0])?.status).toBe("failed");
  expect(options.persist).toHaveBeenCalledTimes(1);
  scope.stop();
});

test("Answer Doctor starts a new attempt when the failed mark is clicked", async () => {
  repairAnswer.mockReset();
  repairAnswer.mockResolvedValue("<Card>### Всё ещё Markdown</Card>");
  const options = ask("<Card>### Сломано</Card>");
  const scope = effectScope();
  const doctor = scope.run(() => useAnswerDoctor(options));
  await waitFor(() => doctor.progress.get("assistant")?.status === "failed");
  expect(repairAnswer).toHaveBeenCalledTimes(3);
  repairAnswer.mockResolvedValueOnce("<Card><h3>Готово</h3></Card>");
  void doctor.retry(options.turns.value[0]);
  await waitFor(() => options.turns.value[0].text === "<Card><h3>Готово</h3></Card>");
  expect(repairAnswer).toHaveBeenCalledTimes(4);
  expect(options.turns.value[0].doctor).toMatchObject({ status: "fixed", attempts: 1 });
  expect(doctor.progress.has("assistant")).toBe(false);
  expect(doctor.reportFor(options.turns.value[0])?.status).toBe("fixed");
  scope.stop();
});

test("Answer Doctor validates each attempt and accepts a fenced answer", async () => {
  repairAnswer.mockReset();
  repairAnswer
    .mockResolvedValueOnce("<Card>### Всё ещё Markdown</Card>")
    .mockResolvedValueOnce("```markdown\n<Card><h3>Готово</h3></Card>\n```");
  const options = ask("<Card>### Сломано</Card>");
  const scope = effectScope();
  const doctor = scope.run(() => useAnswerDoctor(options));
  await waitFor(() => options.turns.value[0].text === "<Card><h3>Готово</h3></Card>");
  expect(repairAnswer).toHaveBeenCalledTimes(2);
  expect(repairAnswer.mock.calls[1][0].answer).toContain("Всё ещё");
  expect(options.persist).toHaveBeenCalledTimes(1);
  expect(doctor.reportFor(options.turns.value[0])).toMatchObject({ attempts: 2 });
  expect(doctorAnswerSource("  \n```text\nГотово\n```\n")).toBe("Готово");
  scope.stop();
});
