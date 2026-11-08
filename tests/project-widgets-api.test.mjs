import "./helpers/builtins.mjs";
import { createServer } from "node:http";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { handleApi } from "../packages/server/app/api.ts";

async function withServer(run) {
  const directory = await mkdtemp(join(tmpdir(), "projector-project-widgets-api-"));
  const project = await realpath(await mkdtemp(join(directory, "project-")));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = join(directory, "data");
  await mkdir(join(directory, "data", "projector"), { recursive: true });
  await mkdir(join(project, ".projector"), { recursive: true });
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
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

test("project widgets API trusts the file and serves declared data", async () => {
  await withServer(async (origin, project) => {
    await writeFile(
      join(project, ".projector", "widgets.json"),
      JSON.stringify({
        version: 1,
        widgets: [
          {
            name: "Metrics",
            summary: "метрики",
            data: { metrics: "metrics.json" },
            template: '<Stat label="Скорость" :value="data.metrics.speed" />',
          },
        ],
      }),
    );
    await writeFile(join(project, "metrics.json"), JSON.stringify({ speed: 42 }));

    const initial = await request(origin, "/api/agent/project-widgets?projectId=p1");
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({ exists: true, trusted: false });

    const denied = await request(
      origin,
      "/api/agent/project-widgets/data?projectId=p1&widget=Metrics",
    );
    expect(denied.status).toBe(400);

    const trusted = await request(origin, "/api/agent/project-widgets/trust", "PUT", {
      projectId: "p1",
      trusted: true,
    });
    expect(await trusted.json()).toMatchObject({ trusted: true });

    const data = await request(
      origin,
      "/api/agent/project-widgets/data?projectId=p1&widget=Metrics",
    );
    expect(await data.json()).toEqual({ data: { metrics: { speed: 42 } }, errors: {} });
  });
});
