import { expect, test, vi } from "vite-plus/test";
import { effectScope, ref } from "vue";

vi.mock("../packages/client/modules/agent/api/client.ts", () => ({ repairForm: vi.fn() }));

const { repairForm } = await import("../packages/client/modules/agent/api/client.ts");
const { useAnswerForm } = await import("../packages/client/modules/agent/model/answer-form.ts");
const { intelligentFormWidget } =
  await import("../packages/core/modules/agent-widgets/intelligent-form/index.ts");
const { inputWidget } = await import("../packages/core/modules/agent-widgets/input/index.ts");
const { registerWidget } = await import("../packages/client/modules/widget-runtime/registry.ts");

registerWidget({ definition: intelligentFormWidget, component: { render: () => null } });
registerWidget({ definition: inputWidget, component: { render: () => null } });

const ask = (text) => ({
  turns: ref([{ id: "assistant", role: "assistant", text, tools: [], at: Date.now() }]),
  busy: ref(false),
  draft: ref(""),
  draftParts: ref([]),
  selection: ref({}),
  send: async () => {},
  edit: () => {},
});

async function waitFor(check, ms = 3000) {
  for (let waited = 0; waited < ms; waited += 25) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(await check()).toBeTruthy();
}

test("Form Doctor repairs a duplicate attribute before showing a form", async () => {
  repairForm.mockReset();
  const options = ask('<IntelligentForm><Input name="next" name="next" /></IntelligentForm>');
  const scope = effectScope();
  const form = scope.run(() => useAnswerForm(options));
  await waitFor(() => Boolean(form.pendingForm.value));
  expect(repairForm).not.toHaveBeenCalled();
  expect(form.originalForm.value).toContain('name="next" name="next"');
  expect(form.pendingForm.value).not.toContain('name="next" name="next"');
  scope.stop();
});

test("Form Doctor asks the Projector doctor when heuristics cannot repair the form", async () => {
  repairForm.mockReset();
  repairForm.mockResolvedValueOnce('<IntelligentForm><Input name="next" /></IntelligentForm>');
  const options = ask('<IntelligentForm><Unknown name="next" /></IntelligentForm>');
  const scope = effectScope();
  const form = scope.run(() => useAnswerForm(options));
  await waitFor(() => Boolean(form.pendingForm.value));
  expect(repairForm).toHaveBeenCalledTimes(1);
  expect(repairForm.mock.calls[0][0].form).toContain("<Unknown");
  expect(form.pendingForm.value).toBe('<IntelligentForm><Input name="next" /></IntelligentForm>');
  scope.stop();
});

test("Form Doctor retries the doctor until the answer compiles", async () => {
  repairForm.mockReset();
  repairForm
    .mockResolvedValueOnce("<IntelligentForm><Unknown /></IntelligentForm>")
    .mockResolvedValueOnce('<IntelligentForm><Input name="next"')
    .mockResolvedValueOnce('<IntelligentForm><Input name="next" /></IntelligentForm>');
  const options = ask("<IntelligentForm><Unknown /></IntelligentForm>");
  const scope = effectScope();
  const form = scope.run(() => useAnswerForm(options));
  await waitFor(() => Boolean(form.pendingForm.value));
  expect(repairForm).toHaveBeenCalledTimes(3);
  expect(form.pendingForm.value).toBe('<IntelligentForm><Input name="next" /></IntelligentForm>');
  scope.stop();
});
