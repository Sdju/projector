import { afterEach, expect, test, vi } from "vite-plus/test";
import { effectScope } from "vue";
import { chatShortTitle, chatTabTitle } from "../packages/client/modules/agent/lib/chat-name.ts";
import { useChatTitle } from "../packages/client/modules/agent/model/chat-titles.ts";

const reply = (body) => ({ ok: true, json: async () => body });
afterEach(() => vi.unstubAllGlobals());

test("a chat is named by its session, then by its first message, then by the agent", () => {
  expect(chatShortTitle("  первое\n сообщение  ")).toBe("первое сообщение");
  expect(chatShortTitle("")).toBe("");
  const long = chatShortTitle("слово ".repeat(30), 40);
  expect(long.length).toBeLessThanOrEqual(40);
  expect(long.endsWith("…")).toBe(true);
  expect(chatTabTitle("  Починить guard ", "fix it", "Claude Code")).toBe("Починить guard");
  expect(chatTabTitle("", "  fix it  ", "Claude Code")).toBe("fix it");
  expect(chatTabTitle(undefined, "", "Claude Code")).toBe("Claude Code");
});

test("an open chat takes the session title the agent gave it", async () => {
  const fetchMock = vi.fn(async () =>
    reply({ sessions: [{ id: "ses_named", title: "Починить guard" }] }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const scope = effectScope();
  const name = scope.run(() =>
    useChatTitle({
      projectId: () => "titles-project",
      backend: () => "claude-code",
      session: () => "ses_named",
      firstMessage: () => "fix it",
      fallback: () => "Claude Code",
      running: () => true,
    }),
  );
  // The first message names the tab until the session list has the agent's name.
  expect(name.value).toBe("fix it");
  await vi.waitFor(() => expect(name.value).toBe("Починить guard"));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  scope.stop();
});

test("a title from the history panel is used without a request", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const scope = effectScope();
  const name = scope.run(() =>
    useChatTitle({
      projectId: () => "known-project",
      backend: () => "codex",
      session: () => "ses_known",
      firstMessage: () => "fix it",
      fallback: () => "Codex",
      running: () => false,
      known: () => [{ id: "ses_known", title: "Из истории" }],
    }),
  );
  expect(name.value).toBe("Из истории");
  expect(fetchMock).not.toHaveBeenCalled();
  scope.stop();
});

test("the Projector agent has no session and is named by its first message", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const scope = effectScope();
  const name = scope.run(() =>
    useChatTitle({
      projectId: () => "projector-project",
      backend: () => "projector",
      session: () => undefined,
      firstMessage: () => "Сделай отчёт",
      fallback: () => "Агент",
      running: () => true,
    }),
  );
  expect(name.value).toBe("Сделай отчёт");
  expect(fetchMock).not.toHaveBeenCalled();
  scope.stop();
});
