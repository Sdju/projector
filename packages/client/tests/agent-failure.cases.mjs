import { afterEach, expect, test, vi } from "vite-plus/test";
import { createState } from "../modules/agent-core/model/chat-state.ts";
import { useChatActions } from "../modules/agent-core/model/chat-actions.ts";
import { loadHistory, INTERRUPTED } from "../modules/agent-core/model/load-history.ts";
import { applyAgentEvent } from "../modules/agent-core/model/turn-events.ts";
import { bannerErrorOf } from "../modules/agent/model/banner-error.ts";

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

test("the failed answer is not repeated in the composer banner", () => {
  const failed = turn("a1", "assistant", "", { failure: "overloaded" });
  const turns = [turn("u1", "user", "почини"), failed];

  expect(bannerErrorOf("overloaded", "", turns)).toBe("");
  expect(bannerErrorOf("overloaded", "Не удалось скопировать", turns)).toBe(
    "Не удалось скопировать",
  );
  expect(bannerErrorOf("Не удалось сохранить чат", "", turns)).toBe("Не удалось сохранить чат");
  expect(bannerErrorOf("Не удалось сохранить чат", "Не удалось скопировать", turns)).toBe(
    "Не удалось сохранить чат",
  );
});

test("an error without a failed answer stays in the banner", () => {
  const turns = [turn("u1", "user", "почини"), turn("a1", "assistant", "ответ")];

  expect(bannerErrorOf("Не удалось сохранить чат", "", turns)).toBe("Не удалось сохранить чат");
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

test("a lost answer takes the session of the previous answer", async () => {
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    json: async () => ({
      turns: [
        turn("u1", "user", "почини"),
        turn("a1", "assistant", "готово", { session: { backend: "opencode", id: "ses_one" } }),
        turn("u2", "user", "а теперь тесты"),
        turn("a2", "assistant", ""),
      ],
    }),
  }));
  const state = createState();

  await loadHistory("/h", state);

  expect(state.turns[3].text).toBe(INTERRUPTED);
  expect(state.turns[3].session).toEqual({ backend: "opencode", id: "ses_one" });
});

test("an already interrupted answer is repaired from the previous session", async () => {
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    json: async () => ({
      turns: [
        turn("u1", "user", "почини"),
        turn("a1", "assistant", "готово", { session: { backend: "opencode", id: "ses_one" } }),
        turn("u2", "user", "а теперь тесты"),
        turn("a2", "assistant", INTERRUPTED),
      ],
    }),
  }));
  const state = createState();

  await loadHistory("/h", state);

  expect(state.turns[3].text).toBe(INTERRUPTED);
  expect(state.turns[3].session).toEqual({ backend: "opencode", id: "ses_one" });
});

test("a detached chat does not lend its session to a lost answer", async () => {
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    json: async () => ({
      turns: [
        turn("u1", "user", "почини"),
        turn("a1", "assistant", "готово", {
          session: { backend: "opencode", id: "ses_one" },
          detached: true,
        }),
        turn("u2", "user", "а теперь тесты"),
        turn("a2", "assistant", ""),
      ],
    }),
  }));
  const state = createState();

  await loadHistory("/h", state);

  expect(state.turns[3].session).toBeUndefined();
});

test("a saved run is not settled: the page will rejoin it", async () => {
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    json: async () => ({
      turns: [
        turn("u1", "user", "почини"),
        turn("a1", "assistant", "частично", {
          run: "run-live",
          tools: [{ id: "t1", name: "shell", status: "running", detail: "git merge" }],
        }),
      ],
    }),
  }));
  const state = createState();

  await loadHistory("/h", state);

  expect(state.turns[1].text).toBe("частично");
  expect(state.turns[1].run).toBe("run-live");
  expect(state.turns[1].tools[0].status).toBe("running");
});
