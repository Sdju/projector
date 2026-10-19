import { createServer } from "node:http";
import { expect, test } from "vite-plus/test";
import {
  fetchRemoteModels,
  pickModel,
  sanitizeModels,
} from "../server/modules/providers/models.ts";

test("registered models get unique aliases and migrate the single legacy model", () => {
  expect(sanitizeModels([{ id: "a" }, { id: "b", alias: "a" }, { id: "c", alias: "x" }])).toEqual([
    { id: "a", alias: "a" },
    { id: "c", alias: "x" },
  ]);
  expect(sanitizeModels(undefined, "m")).toEqual([{ id: "m", alias: "m" }]);
  const models = sanitizeModels([{ id: "a" }, { id: "b", alias: "fast" }]);
  expect(pickModel(models, "fast")?.id).toBe("b");
  expect(pickModel(models, "nope")?.id).toBe("a");
  expect(pickModel([], "x")).toBeNull();
});

test("the model list is read from an OpenAI-style /models answer", async () => {
  let auth;
  const server = createServer((req, res) => {
    auth = req.headers.authorization;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: [{ id: "z" }, { id: "a" }, { id: "a" }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    expect(await fetchRemoteModels(url, "k")).toEqual(["a", "z"]);
    expect(auth).toBe("Bearer k");
  } finally {
    server.close();
  }
});
