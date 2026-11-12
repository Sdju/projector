import "../../../tests/helpers/builtins.mjs";
import { createServer } from "node:http";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { handleApi } from "../app/api.ts";

async function withServer(run) {
  const directory = await mkdtemp(join(tmpdir(), "projector-presets-api-"));
  const project = await realpath(await mkdtemp(join(directory, "project-")));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = join(directory, "data");
  await mkdir(join(directory, "data", "projector"), { recursive: true });
  await writeFile(
    join(directory, "data", "projector", "projects.json"),
    JSON.stringify({ projects: [{ id: "p1", name: "Project", path: project, commands: [] }] }),
  );
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
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

const request = (origin, path, method = "GET", body) =>
  fetch(`${origin}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Origin: origin },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

test("presets API manages global and project presets", async () => {
  await withServer(async (origin) => {
    const initial = await request(origin, "/api/agent/presets?projectId=p1");
    expect(initial.status).toBe(200);
    expect(initial.headers.get("cache-control")).toBe("no-store");
    const first = await initial.json();
    expect(first).toMatchObject({ presets: [] });
    expect(first.project).toMatchObject({ projectId: "p1", exists: false, trusted: false });

    const denied = await fetch(`${origin}/api/agent/presets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preset: { title: "Нельзя", prompt: "Текст" } }),
    });
    expect(denied.status).toBe(403);

    const globalResponse = await request(origin, "/api/agent/presets", "POST", {
      preset: {
        title: "Общий пресет",
        prompt: "Проверь проект.",
        form: '<IntelligentForm summary="Старт"><Field name="mode" label="Режим" /></IntelligentForm>',
      },
    });
    expect(globalResponse.status).toBe(201);
    const global = await globalResponse.json();
    expect(global.presets).toHaveLength(1);
    expect(global.presets[0]).toMatchObject({
      title: "Общий пресет",
      prompt: "Проверь проект.",
    });
    expect(global.presets[0].form).toContain("<IntelligentForm");
    const globalId = global.presets[0].id;

    const updatedResponse = await request(origin, `/api/agent/presets/${globalId}`, "PUT", {
      preset: { title: "Общий пресет 2", prompt: "Новый текст." },
    });
    expect(updatedResponse.status).toBe(200);
    expect((await updatedResponse.json()).presets[0].title).toBe("Общий пресет 2");

    const projectResponse = await request(origin, "/api/agent/presets", "POST", {
      projectId: "p1",
      preset: { title: "Пресет проекта", prompt: "Сверься с README." },
    });
    expect(projectResponse.status).toBe(201);
    const created = await projectResponse.json();
    expect(created.project).toMatchObject({ exists: true, trusted: true });
    expect(created.project.presets).toHaveLength(1);

    const trustedResponse = await request(origin, "/api/agent/presets/trust", "PUT", {
      projectId: "p1",
      trusted: true,
    });
    expect(trustedResponse.status).toBe(200);
    expect((await trustedResponse.json()).project.trusted).toBe(true);

    const readAgain = await (await request(origin, "/api/agent/presets?projectId=p1")).json();
    expect(readAgain.presets).toHaveLength(1);
    expect(readAgain.project).toMatchObject({ trusted: true });
    expect(readAgain.project.presets[0].title).toBe("Пресет проекта");

    const deletedGlobal = await request(origin, `/api/agent/presets/${globalId}`, "DELETE");
    expect(deletedGlobal.status).toBe(200);
    expect((await deletedGlobal.json()).presets).toEqual([]);

    const projectId = created.project.presets[0].id;
    const deletedProject = await request(
      origin,
      `/api/agent/presets/${projectId}?projectId=p1`,
      "DELETE",
    );
    expect(deletedProject.status).toBe(200);
    expect((await deletedProject.json()).project.presets).toEqual([]);

    const bad = await request(origin, "/api/agent/presets", "POST", {
      preset: { title: "", prompt: "" },
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain("Некорректный");
  });
});
