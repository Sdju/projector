import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import "./helpers/builtins.mjs";
import { handleApi } from "../packages/server/app/api.ts";
import { closeHistoryStore } from "../packages/server/modules/agent/history-store.ts";

async function withServer(run) {
  const directory = await mkdtemp(join(tmpdir(), "projector-roles-api-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
  const server = createServer((req, res) => {
    void handleApi(req, res).then((handled) => {
      if (!handled) res.writeHead(404).end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(origin);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    closeHistoryStore();
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

test("roles API reads, saves and resets a service role", async () => {
  await withServer(async (origin) => {
    const initial = await fetch(`${origin}/api/agent/roles`);
    expect(initial.status).toBe(200);
    expect(initial.headers.get("cache-control")).toBe("no-store");
    const first = await initial.json();
    expect(first.roles.map((role) => role.id)).toEqual(["doctor", "lens", "judge"]);
    expect(first.roles.every((role) => role.inherited)).toBe(true);

    const denied = await fetch(`${origin}/api/agent/roles/lens`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selection: { provider: "test:model" } }),
    });
    expect(denied.status).toBe(403);

    const savedResponse = await fetch(`${origin}/api/agent/roles/lens`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ selection: { provider: "test:model" } }),
    });
    expect(savedResponse.status).toBe(200);
    const saved = await savedResponse.json();
    expect(saved.roles.find((role) => role.id === "lens")).toMatchObject({
      selection: { provider: "test:model" },
      inherited: false,
    });

    const readAgain = await (await fetch(`${origin}/api/agent/roles`)).json();
    expect(readAgain.roles.find((role) => role.id === "lens").selection.provider).toBe(
      "test:model",
    );

    const resetResponse = await fetch(`${origin}/api/agent/roles/lens/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: "{}",
    });
    expect(resetResponse.status).toBe(200);
    const reset = await resetResponse.json();
    expect(reset.roles.find((role) => role.id === "lens").inherited).toBe(true);

    const bad = await fetch(`${origin}/api/agent/roles/unknown`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        role: { name: "Неизвестная", agent: "projector", selection: {} },
      }),
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain("Неизвестная");
  });
});

test("roles API creates, updates and deletes a chat role", async () => {
  await withServer(async (origin) => {
    const createdResponse = await fetch(`${origin}/api/agent/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        role: {
          name: "Ревьюер",
          description: "Проверяет изменения",
          agent: "projector",
          selection: { provider: "test:model" },
        },
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    const role = created.created;
    expect(role).toMatchObject({ kind: "chat", name: "Ревьюер", agent: "projector" });
    expect(role.id).toMatch(/^role-/);
    expect(created.roles.map((item) => item.id)).toContain(role.id);

    const snapshot = {
      roleId: role.id,
      name: role.name,
      selection: role.selection,
    };
    const historyWrite = await fetch(`${origin}/api/agent/history/role-chat`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ turns: [], role: snapshot }),
    });
    expect(historyWrite.status).toBe(200);
    const historyRead = await (await fetch(`${origin}/api/agent/history/role-chat`)).json();
    expect(historyRead.role).toEqual(snapshot);

    const savedResponse = await fetch(`${origin}/api/agent/roles/${role.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        role: { ...role, name: "Старший ревьюер", selection: { provider: "test:other" } },
      }),
    });
    expect(savedResponse.status).toBe(200);
    const saved = await savedResponse.json();
    expect(saved.roles.find((item) => item.id === role.id)).toMatchObject({
      name: "Старший ревьюер",
      selection: { provider: "test:other" },
    });

    const deletedResponse = await fetch(`${origin}/api/agent/roles/${role.id}`, {
      method: "DELETE",
      headers: { Origin: origin },
    });
    expect(deletedResponse.status).toBe(200);
    const deleted = await deletedResponse.json();
    expect(deleted.roles.some((item) => item.id === role.id)).toBe(false);

    const serviceDelete = await fetch(`${origin}/api/agent/roles/doctor`, {
      method: "DELETE",
      headers: { Origin: origin },
    });
    expect(serviceDelete.status).toBe(400);
  });
});

test("history API keeps the messages waiting for the answer", async () => {
  await withServer(async (origin) => {
    const queue = [
      {
        id: "queued-1",
        text: "после ответа",
        parts: [
          { type: "text", text: "после ответа" },
          { type: "file", path: "src/app.ts", range: { from: 3, to: 9 } },
        ],
        form: { source: "<Form />", values: { next: "a" }, summary: "Дальше" },
        auto: "job-1",
        autoTitle: "Проверка",
      },
    ];
    const write = await fetch(`${origin}/api/agent/history/queue-chat`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ turns: [], queue }),
    });
    expect(write.status).toBe(200);
    expect((await write.json()).queue).toEqual(queue);

    const read = await (await fetch(`${origin}/api/agent/history/queue-chat`)).json();
    expect(read.queue).toEqual(queue);

    const cleared = await fetch(`${origin}/api/agent/history/queue-chat`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ turns: [], queue: [] }),
    });
    expect(cleared.status).toBe(200);
    expect((await (await fetch(`${origin}/api/agent/history/queue-chat`)).json()).queue).toBeNull();
  });
});
