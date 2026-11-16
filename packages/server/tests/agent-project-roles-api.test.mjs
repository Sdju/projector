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

// The body explains a failed write (a permission or lock message from the OS), the code alone does not.
const expectState = async (response, status) => {
  const text = await response.text();
  expect(response.status, text).toBe(status);
  return text ? JSON.parse(text) : undefined;
};

test("project roles API creates, trusts, updates and deletes a role", async () => {
  await withServer(async (origin, project) => {
    const initial = await expectState(
      await request(origin, "/api/agent/project-roles?projectId=p1"),
      200,
    );
    expect(initial).toMatchObject({
      projectId: "p1",
      path: project,
      exists: false,
      trusted: false,
      roles: [],
    });

    const created = await expectState(
      await request(origin, "/api/agent/project-roles", "POST", {
        projectId: "p1",
        role: {
          name: "Ревьюер проекта",
          agent: "projector",
          selection: { provider: "env:test" },
        },
      }),
      201,
    );
    expect(created).toMatchObject({ exists: true, trusted: false });
    expect(created.roles).toHaveLength(1);
    const role = created.roles[0];

    const trusted = await expectState(
      await request(origin, "/api/agent/project-roles/trust", "PUT", {
        projectId: "p1",
        trusted: true,
      }),
      200,
    );
    expect(trusted.trusted).toBe(true);

    const afterUpdate = await expectState(
      await request(origin, `/api/agent/project-roles/${role.id}`, "PUT", {
        projectId: "p1",
        role: { ...role, name: "Старший ревьюер" },
      }),
      200,
    );
    expect(afterUpdate).toMatchObject({ trusted: false });
    expect(afterUpdate.roles[0].name).toBe("Старший ревьюер");

    const afterDelete = await expectState(
      await request(origin, `/api/agent/project-roles/${role.id}?projectId=p1`, "DELETE"),
      200,
    );
    expect(afterDelete.roles).toEqual([]);

    await expectState(
      await request(origin, "/api/agent/project-roles", "POST", {
        projectId: "p1",
        role: { name: "Плохая", agent: "nope", selection: {} },
      }),
      400,
    );
  });
});
