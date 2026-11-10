import "../../../tests/helpers/builtins.mjs";
import { createServer } from "node:http";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { handleApi } from "../app/api.ts";

async function withServer(run) {
  const directory = await mkdtemp(join(tmpdir(), "projector-project-roles-api-"));
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
    await run(origin, project);
  } finally {
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
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test("project roles API creates, trusts, updates and deletes a role", async () => {
  await withServer(async (origin, project) => {
    const initial = await request(origin, "/api/agent/project-roles?projectId=p1");
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({
      projectId: "p1",
      path: project,
      exists: false,
      trusted: false,
      roles: [],
    });

    const createdResponse = await request(origin, "/api/agent/project-roles", "POST", {
      projectId: "p1",
      role: {
        name: "Ревьюер проекта",
        agent: "projector",
        selection: { provider: "env:test" },
      },
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    expect(created).toMatchObject({ exists: true, trusted: false });
    expect(created.roles).toHaveLength(1);
    const role = created.roles[0];

    const denied = await request(origin, "/api/agent/project-roles/trust", "PUT", {
      projectId: "p1",
      trusted: true,
    });
    expect(denied.status).toBe(200);
    const trusted = await denied.json();
    expect(trusted.trusted).toBe(true);

    const updated = await request(origin, `/api/agent/project-roles/${role.id}`, "PUT", {
      projectId: "p1",
      role: { ...role, name: "Старший ревьюер" },
    });
    expect(updated.status).toBe(200);
    const afterUpdate = await updated.json();
    expect(afterUpdate).toMatchObject({ trusted: false });
    expect(afterUpdate.roles[0].name).toBe("Старший ревьюер");

    const deleted = await request(
      origin,
      `/api/agent/project-roles/${role.id}?projectId=p1`,
      "DELETE",
    );
    expect(deleted.status).toBe(200);
    expect((await deleted.json()).roles).toEqual([]);

    const badAgent = await request(origin, "/api/agent/project-roles", "POST", {
      projectId: "p1",
      role: { name: "Плохая", agent: "nope", selection: {} },
    });
    expect(badAgent.status).toBe(400);
  });
});
