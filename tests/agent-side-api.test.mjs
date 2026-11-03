import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { handleApi } from "../packages/server/app/api.ts";
import { registerAgentBackend } from "../packages/server/modules/agent/index.ts";
import { projectorBackend } from "../packages/server/modules/agents/projector/projector-backend.ts";
import { scriptedModel } from "./helpers/scripted-model.mjs";

function parse(chunk) {
  const events = [];
  for (const part of chunk.split("\n\n")) {
    let name = "";
    const data = [];
    for (const line of part.split("\n")) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (name) events.push({ event: name, data: JSON.parse(data.join("\n") || "{}") });
  }
  return events;
}

test("POST /api/agent/side streams a read-only side answer and answers its command request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "projector-side-api-"));
  const project = join(directory, "project");
  await mkdir(project, { recursive: true });
  await mkdir(join(directory, "projector"), { recursive: true });
  await writeFile(
    join(directory, "projector/projects.json"),
    JSON.stringify({
      projects: [
        {
          id: "project-1",
          name: "Project 1",
          path: project,
          url: "",
          icon: "",
          mode: "server",
          commands: [],
          createdAt: "",
        },
      ],
    }),
  );
  const model = await scriptedModel([
    { tool: "chat_status", args: { chat: "chat-1" } },
    { text: "Процесс жив: событий нет 40 секунд, разрешений не ждёт." },
  ]);
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
  registerAgentBackend(projectorBackend);
  const server = createServer((req, res) => {
    void handleApi(req, res).then((handled) => {
      if (!handled) res.writeHead(404).end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const events = [];
  const commands = [];
  try {
    const response = await fetch(`${origin}/api/agent/side`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        question: "завис ли процесс?",
        chat: "chat-1",
        projectId: "project-1",
        history: [
          { role: "user", content: "почини сборку" },
          { role: "assistant", content: "запускаю сборку" },
        ],
      }),
    });
    expect(response.status).toBe(200);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const event of parse(parts.join("\n\n"))) {
        events.push(event);
        if (event.event === "command-request") {
          commands.push(event.data);
          const answer = await fetch(`${origin}/api/agent/tool-result`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Origin: origin },
            body: JSON.stringify({
              id: event.data.id,
              output: {
                chat: "chat-1",
                busy: true,
                phase: "думает",
                health: "quiet",
                sinceLastEventMs: 40_000,
                live: { found: true },
              },
            }),
          });
          expect(answer.status).toBe(200);
        }
      }
    }
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      operation: "execute",
      command: "ide.agent.chat.status",
      scope: "editor:project-1",
      args: { chat: "chat-1" },
    });
    expect(events.some((item) => item.event === "meta")).toBe(true);
    expect(events.some((item) => item.event === "tool" && item.data.name === "chat_status")).toBe(
      true,
    );
    expect(events.some((item) => item.event === "tool-result")).toBe(true);
    expect(events.find((item) => item.event === "done")?.data.text).toContain("Процесс жив");
    await expect(stat(join(directory, "projector/agent/runs"))).rejects.toThrow();
    await expect(stat(join(directory, "projector/agent/history.sqlite"))).rejects.toThrow();
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await model.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
