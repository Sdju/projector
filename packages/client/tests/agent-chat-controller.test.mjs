import { expect, test } from "vite-plus/test";
import { createChatController } from "../modules/agent/model/chat-controller.ts";

/** Only the state the groups read: the composition does not own any of it. */
function fakeChat() {
  const sent = [];
  const injected = [];
  const state = {
    key: "p",
    turns: { value: [] },
    busy: { value: false },
    permissions: { value: [] },
    questions: { value: [] },
    secrets: { value: [] },
    capabilities: { value: { inject: true } },
    controls: { value: [] },
    selection: { value: {} },
    queue: { value: [] },
    isolate: { value: false },
    setControl: async () => {},
    send: async (text) => {
      sent.push(text);
    },
    injectQueued: async (id) => {
      injected.push(id);
      return true;
    },
    removeQueued: () => {},
    loadSessions: async () => [],
    resumeSession: async () => {},
    removeSession: async () => {},
    edit: () => {},
    retry: async () => {},
    stop: () => {},
    showVersion: () => {},
    worktreeId: () => undefined,
    worktreeInfo: async () => undefined,
    mergeCopy: async () => "",
    discardCopy: async () => {},
  };
  return { state, sent, injected };
}

function controllerOf(chat) {
  const calls = [];
  const composer = {
    attach: async (chips) => calls.push(["attach", chips]),
    appendText: async (text) => calls.push(["appendText", text]),
    showForm: () => calls.push(["showForm"]),
    hideForm: () => calls.push(["hideForm"]),
  };
  const lens = {
    state: { open: false },
    open: async () => "caption",
    close: () => {},
    refresh: async () => "caption",
    setAuto: () => {},
  };
  const side = {
    status: async () => ({ busy: false }),
    openPanel: () => {},
    ask: async () => "answer",
    clear: () => {},
  };
  const controller = createChatController({
    projectId: "p",
    backend: "projector",
    label: "Projector",
    chat,
    visible: () => true,
    composer: () => composer,
    controls: () => ({ toggle: () => calls.push(["toggle"]) }),
    pendingForm: () => "form:1",
    fork: async (turnId) => ({ chat: turnId }),
    compact: async () => {},
    rewindTo: async () => undefined,
    lens,
    side,
  });
  return { controller, calls };
}

test("the controller reads live chat state instead of copying it", () => {
  const { state } = fakeChat();
  const { controller } = controllerOf(state);
  expect(controller.busy()).toBe(false);
  expect(controller.needsUser()).toBe(false);
  state.busy.value = true;
  state.questions.value.push({ id: "q" });
  expect(controller.busy()).toBe(true);
  expect(controller.needsUser()).toBe(true);
  expect(controller.capabilities()).toEqual({ inject: true });
  expect(controller.visible()).toBe(true);
});

test("the composer, form and parameters groups delegate to their modules", async () => {
  const { state } = fakeChat();
  const { controller, calls } = controllerOf(state);
  await controller.attach([{ type: "file", path: "a.ts" }]);
  await controller.appendText("text");
  controller.showForm();
  controller.hideForm();
  controller.toggleControlsMenu();
  expect(controller.pendingForm()).toBe("form:1");
  expect(calls).toEqual([
    ["attach", [{ type: "file", path: "a.ts" }]],
    ["appendText", "text"],
    ["showForm"],
    ["hideForm"],
    ["toggle"],
  ]);
});

test("sending, injecting and the queue keep the chat's own order", async () => {
  const { state, sent, injected } = fakeChat();
  const { controller } = controllerOf(state);
  await controller.send("hello");
  state.queue.value.push({ id: "q1", text: "later" });
  expect(controller.queue()).toHaveLength(1);
  expect(await controller.inject("later")).toBe(true);
  expect(sent).toEqual(["hello", "later"]);
  expect(injected).toEqual(["q1"]);
});

test("sessions, history and the isolated copy delegate to the chat", async () => {
  const { state } = fakeChat();
  const { controller } = controllerOf(state);
  expect(await controller.loadSessions()).toEqual([]);
  expect(await controller.rewind("u1", "conversation")).toEqual({ ok: true, files: [] });
  expect(await controller.worktree()).toBeUndefined();
  controller.setIsolate(true);
  expect(state.isolate.value).toBe(true);
  expect(controller.exportMarkdown()).toBeTypeOf("string");
});
