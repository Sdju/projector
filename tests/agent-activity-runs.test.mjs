import { expect, test, vi } from "vite-plus/test";
import { effectScope, ref } from "vue";
import { useAgentActivity } from "../src/modules/agent/model/activity.ts";
import { registerChat } from "../src/modules/agent/model/chat-registry.ts";

test("a disconnected chat does not hide a live server run, and an active chat does not duplicate it", async () => {
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const busy = ref(false);
  let runs = [
    { id: "abc", backend: "kimi", chat: "kimi:p:probe", projectId: "p", topic: "server task" },
    { id: "def", backend: "kimi", chat: "kimi:p:probe", projectId: "p", topic: "server task" },
  ];
  vi.stubGlobal("document", document);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => ({
      ok: true,
      json: async () => (String(url).includes("/runs") ? { runs } : { jobs: [] }),
    })),
  );
  const unregister = registerChat({
    key: "kimi:p:probe",
    projectId: "p",
    label: "Kimi",
    busy: () => busy.value,
    tasks: () => [],
    turns: () => [{ role: "user", text: "local task" }],
  });
  const scope = effectScope();
  try {
    const activity = scope.run(() => useAgentActivity());
    await vi.waitFor(() =>
      expect(activity.items.value).toMatchObject([
        { chat: "kimi:p:probe", busy: true, topic: "server task" },
      ]),
    );
    busy.value = true;
    expect(activity.items.value).toMatchObject([{ chat: "kimi:p:probe", topic: "local task" }]);
    expect(activity.items.value).toHaveLength(1);
    busy.value = false;
    expect(activity.items.value).toMatchObject([{ chat: "kimi:p:probe", topic: "server task" }]);
    expect(activity.items.value).toHaveLength(1);
    // Equal topics in separate chats are independent agents, and must stay visible.
    runs = [...runs, { ...runs[0], id: "other", chat: "kimi:p:other" }];
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(activity.items.value).toHaveLength(2));
    runs = [];
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(activity.items.value).toEqual([]));
  } finally {
    scope.stop();
    unregister();
    vi.unstubAllGlobals();
  }
});
