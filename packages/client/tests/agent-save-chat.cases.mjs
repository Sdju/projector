import { afterEach, expect, test, vi } from "vite-plus/test";
import { createState } from "../modules/agent-core/model/chat-state.ts";
import { saveChat } from "../modules/agent-core/model/save-chat.ts";

afterEach(() => vi.unstubAllGlobals());

test("a save rejected by a proxy without JSON still names the status", async () => {
  // A reverse proxy rejects an oversized history with its own HTML page, not the server's error.
  vi.stubGlobal("fetch", async () => ({
    ok: false,
    status: 413,
    json: async () => {
      throw new SyntaxError("Unexpected token '<'");
    },
  }));
  const state = createState();

  saveChat("save-http-413", "/api/agent/history/chat", state);

  await vi.waitFor(() => expect(state.error).toBe("Не удалось сохранить историю чата: HTTP 413"));
});

test("a save rejected by the server keeps its reason", async () => {
  vi.stubGlobal("fetch", async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: "Повторяющийся ID сообщения: a1" }),
  }));
  const state = createState();

  saveChat("save-server-reason", "/api/agent/history/chat", state);

  await vi.waitFor(() =>
    expect(state.error).toBe("Не удалось сохранить историю чата: Повторяющийся ID сообщения: a1"),
  );
});
