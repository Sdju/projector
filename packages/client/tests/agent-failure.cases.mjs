import { afterEach, expect, test, vi } from "vite-plus/test";
import { createState } from "../modules/agent-core/model/chat-state.ts";
import { useChatActions } from "../modules/agent-core/model/chat-actions.ts";
import { loadHistory, INTERRUPTED } from "../modules/agent-core/model/load-history.ts";
import { applyAgentEvent } from "../modules/agent-core/model/turn-events.ts";

const turn = (id, role, text = id, extra = {}) => ({ id, role, text, tools: [], ...extra });

afterEach(() => vi.unstubAllGlobals());

test("an error is kept on the answer that failed, not only in the chat banner", () => {
  const state = createState();
  const assistant = turn("a1", "assistant", "");
  state.turns = [turn("u1", "user", "почини"), assistant];

  applyAgentEvent(
    state,
    state.turns[1],
    { event: "error", data: { error: "Upstream request failed: overloaded" } },
    () => {},
  );

  expect(state.error).toBe("Upstream request failed: overloaded");
  expect(assistant.failure).toBe("Upstream request failed: overloaded");
  expect(assistant.run).toBeUndefined();
});

test("retry sends the same message again and keeps the failed attempt as a version", async () => {
  const state = createState();
  state.turns = [
    turn("u1", "user", "почини"),
    turn("a1", "assistant", "", { failure: "overloaded" }),
  ];
  state.capabilities = { branchSession: true, inject: true };
  const sent = [];
  const actions = useChatActions(state, {
    backend: "opencode",
    projectId: "p",
    ready: Promise.resolve(),
    persist: () => {},
    send: async (text) => void sent.push(text),
    stop: () => {},
  });

  await actions.retry("a1");

  expect(sent).toEqual(["почини"]);
  expect(state.turns).toEqual([]);
  expect(state.stash.versions[0].map((item) => item.id)).toEqual(["u1", "a1"]);
  expect(state.stash.versions[0][1].failure).toBe("overloaded");
  expect(state.error).toBe("");
});

test("a failed answer survives reload and still offers retry", async () => {
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    json: async () => ({
      turns: [turn("u1", "user", "почини"), turn("a1", "assistant", "", { failure: "overloaded" })],
    }),
  }));
  const state = createState();

  await loadHistory("/h", state);

  expect(state.turns[1].text).toBe("");
  expect(state.turns[1].failure).toBe("overloaded");
});

test("an empty answer without a failure is still shown as interrupted", async () => {
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    json: async () => ({ turns: [turn("u1", "user", "почини"), turn("a1", "assistant", "")] }),
  }));
  const state = createState();

  await loadHistory("/h", state);

  expect(state.turns[1].text).toBe(INTERRUPTED);
});
