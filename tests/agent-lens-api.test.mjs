import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { handleApi } from "../packages/server/app/api.ts";
import {
  LENS_THINKING_TEXT,
  lensLine,
  runLens,
} from "../packages/server/modules/agents/projector/index.ts";
import { scriptedModel } from "./helpers/scripted-model.mjs";

test("Lens cleans its caption into one line", () => {
  expect(lensLine("Lens: **Собирает** проект.")).toBe("Собирает проект.");
  expect(lensLine("```vue\nЧто-то\n```\nПишет тесты.")).toBe("Пишет тесты.");
  expect(lensLine("x".repeat(500)).length).toBe(400);
  expect(lensLine("   ")).toBe("");
});

test("Lens does not call the model before the first reasoning or call", async () => {
  const text = await runLens({
    history: [{ role: "user", content: "почини сборку" }],
    busy: true,
    phase: "думает",
    running: [],
    plan: [],
    queue: 0,
    selection: { provider: "env:test" },
  });
  expect(text).toBe(LENS_THINKING_TEXT);
  const idle = await runLens({
    history: [{ role: "user", content: "почини сборку" }],
    busy: false,
    phase: "",
    running: [],
    plan: [],
    queue: 0,
    selection: { provider: "env:test" },
  });
  expect(idle).toContain("нет работы");
});

test(
  "POST /api/agent/lens captions the current work from the visible chat",
  { timeout: 120_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "projector-lens-api-"));
    await mkdir(join(directory, "projector"), { recursive: true });
    const model = await scriptedModel([{ text: "Собирает проект после правки сборки." }]);
    const old = Object.fromEntries(
      ["XDG_DATA_HOME", "OPENAI_URL", "OPENAI_API_KEY", "OPENAI_MODEL"].map((key) => [
        key,
        process.env[key],
      ]),
    );
    Object.assign(process.env, {
      XDG_DATA_HOME: directory,
      OPENAI_URL: model.url,
      OPENAI_API_KEY: "test",
      OPENAI_MODEL: "test",
    });
    const requests = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith(model.url) && init?.body) requests.push(JSON.parse(init.body));
      return originalFetch(url, init);
    };
    const server = createServer((req, res) => {
      void handleApi(req, res).then((handled) => {
        if (!handled) res.writeHead(404).end();
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const body = {
      history: [
        { role: "user", content: "почини сборку" },
        {
          role: "assistant",
          content: "запускаю сборку",
          thoughts: "Сначала проверю, почему падает сборка",
        },
      ],
      state: {
        busy: true,
        phase: "думает",
        running: [{ name: "Bash", input: '{"command":"vp build"}', startedAt: 1 }],
        plan: [{ content: "Собрать проект", status: "in_progress" }],
        queue: 1,
      },
      selection: { provider: "env:test" },
    };
    try {
      const response = await fetch(`${origin}/api/agent/lens`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(200);
      const answer = await response.json();
      expect(answer.text).toBe("Собирает проект после правки сборки.");
      expect(typeof answer.at).toBe("number");
      expect(requests).toHaveLength(1);
      const messages = requests[0].messages;
      expect(messages.some((item) => item.role === "system" && item.content.includes("Lens"))).toBe(
        true,
      );
      const prompt = messages.at(-1).content;
      expect(prompt).toContain("Пользователь: почини сборку");
      expect(prompt).toContain("Ассистент: запускаю сборку");
      expect(prompt).toContain("Рассуждение: Сначала проверю, почему падает сборка");
      expect(prompt).toContain("Самое свежее рассуждение агента");
      expect(prompt).toContain("Сейчас выполняются");
      expect(prompt).toContain("vp build");
      expect(prompt).toContain("Собрать проект");
      expect(prompt).toContain("Очередь: 1");

      // The caption is a view: no run records and no chat history are written.
      await expect(stat(join(directory, "projector/agent/runs"))).rejects.toThrow();
      await expect(stat(join(directory, "projector/agent/history.sqlite"))).rejects.toThrow();
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      globalThis.fetch = originalFetch;
      for (const [key, value] of Object.entries(old)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await model.close();
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  },
);

test("POST /api/agent/lens is open only to the Projector page and needs something to describe", async () => {
  const directory = await mkdtemp(join(tmpdir(), "projector-lens-guard-"));
  const old = Object.fromEntries(
    ["XDG_DATA_HOME", "OPENAI_URL", "OPENAI_API_KEY", "OPENAI_MODEL"].map((key) => [
      key,
      process.env[key],
    ]),
  );
  Object.assign(process.env, { XDG_DATA_HOME: directory });
  const server = createServer((req, res) => {
    void handleApi(req, res).then((handled) => {
      if (!handled) res.writeHead(404).end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const noOrigin = await fetch(`${origin}/api/agent/lens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history: [{ role: "user", content: "привет" }] }),
    });
    expect(noOrigin.status).toBe(403);
    const empty = await fetch(`${origin}/api/agent/lens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({}),
    });
    expect(empty.status).toBe(400);
    expect((await empty.json()).error).toContain("нечего показывать");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
