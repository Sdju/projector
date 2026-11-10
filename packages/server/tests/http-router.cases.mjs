import { expect, test } from "vite-plus/test";
import { createRouteDispatcher } from "../modules/transport/index.ts";

const context = (method, path) => ({ method, path, url: new URL(path, "http://localhost") });

test("routes by method and specificity, retaining encoded params and the original transport", async () => {
  const seen = [];
  const dispatch = createRouteDispatcher([
    { method: "GET", path: "/api/projects/:id", handler: (ctx) => seen.push(ctx) },
    { method: "GET", path: "/api/projects/search", handler: () => seen.push("search") },
    { method: "PUT", path: "/api/projects/:id", handler: () => seen.push("write") },
  ]);
  const req = {};
  const res = {};
  expect(await dispatch({ ...context("GET", "/api/projects/a%2Fb"), req, res })).toBe(true);
  expect(seen[0].params).toEqual({ id: "a%2Fb" });
  expect(seen[0].req).toBe(req);
  expect(seen[0].res).toBe(res);
  expect(await dispatch(context("GET", "/api/projects/search"))).toBe(true);
  expect(await dispatch(context("PUT", "/api/projects/one"))).toBe(true);
  expect(await dispatch(context("POST", "/api/projects/one"))).toBe(false);
  expect(await dispatch(context("GET", "/api/missing"))).toBe(false);
  expect(seen.slice(1)).toEqual(["search", "write"]);
});

test("explicit method fallbacks preserve endpoint-specific 405 behavior", async () => {
  const dispatch = createRouteDispatcher([
    {
      method: "",
      path: "/api/browser/session",
      handler: () => {
        throw new Error("GET only");
      },
    },
    { method: "GET", path: "/api/browser/session", handler: () => {} },
    { method: ["GET", "PUT"], path: "/api/settings", handler: () => {} },
  ]);
  expect(await dispatch(context("GET", "/api/browser/session"))).toBe(true);
  await expect(dispatch(context("POST", "/api/browser/session"))).rejects.toThrow("GET only");
  expect(await dispatch(context("PUT", "/api/settings"))).toBe(true);
  expect(await dispatch(context("DELETE", "/api/settings"))).toBe(false);
});

test("a request keeps its handler generation and params across an asynchronous reload", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const seen = [];
  const first = createRouteDispatcher([
    {
      method: "GET",
      path: "/api/runs/:id",
      handler: async ({ params }) => {
        await pending;
        seen.push(`old:${params.id}`);
      },
    },
  ]);
  const request = first(context("GET", "/api/runs/one"));
  const next = createRouteDispatcher([
    {
      method: "GET",
      path: "/api/runs/:id",
      handler: ({ params }) => {
        seen.push(`new:${params.id}`);
      },
    },
  ]);
  await next(context("GET", "/api/runs/two"));
  release();
  await request;
  expect(seen).toEqual(["new:two", "old:one"]);
});
