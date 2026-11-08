import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { providersPath } from "../packages/core/modules/app-paths/index.ts";
import { resetServiceRole, saveServiceRole } from "../packages/server/modules/agent-roles/index.ts";
import { runLens } from "../packages/server/modules/agents/projector/index.ts";
import { scriptedModel } from "./helpers/scripted-model.mjs";

test("service roles use their own model over the chat's model", async () => {
  const directory = await mkdtemp(join(tmpdir(), "projector-roles-service-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
  const model = await scriptedModel([{ text: "Собирает проект." }, { text: "Пишет тесты." }]);
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const target = url instanceof Request ? url.url : url instanceof URL ? url.href : url;
    if (target.startsWith(model.url) && typeof init?.body === "string")
      requests.push(JSON.parse(init.body));
    return originalFetch(url, init);
  };
  try {
    await mkdir(join(directory, "projector"), { recursive: true });
    await writeFile(
      providersPath(),
      JSON.stringify({
        activeProviderId: "test",
        providers: [
          {
            id: "test",
            name: "Test",
            kind: "custom",
            thinkingStyle: "none",
            url: model.url,
            enabled: true,
            models: [
              { id: "chat-model", alias: "chat-model" },
              { id: "role-model", alias: "role-model" },
            ],
          },
        ],
      }),
      "utf8",
    );
    const request = {
      history: [
        { role: "user", content: "почини сборку" },
        {
          role: "assistant",
          content: "запускаю сборку",
          thoughts: "Сначала проверю, почему падает сборка",
        },
      ],
      busy: true,
      phase: "думает",
      running: [{ name: "Bash", input: "vp build", startedAt: 1 }],
      plan: [],
      queue: 0,
      selection: { provider: "test:chat-model" },
    };

    await saveServiceRole("lens", { provider: "test:role-model" });
    expect(await runLens(request)).toBe("Собирает проект.");
    expect(requests[0].model).toBe("role-model");

    await resetServiceRole("lens");
    expect(await runLens(request)).toBe("Пишет тесты.");
    expect(requests[1].model).toBe("chat-model");
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await model.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
