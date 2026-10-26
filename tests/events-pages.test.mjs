import { EventEmitter } from "node:events";
import { expect, test } from "vite-plus/test";
import {
  attachSse,
  broadcastEvent,
  onEventClientClose,
  updateEventPages,
} from "../server/modules/events/index.ts";

function stream(client) {
  const req = Object.assign(new EventEmitter(), { url: `/api/events?client=${client}` });
  const chunks = [];
  const res = { writeHead() {}, write: (chunk) => chunks.push(chunk) };
  attachSse(req, res);
  return { req, chunks };
}

test("one stream serves several pages and releases each of them", () => {
  const closed = [];
  const off = onEventClientClose((id) => closed.push(id));
  const shared = stream("events-pages-stream");
  expect(updateEventPages("events-pages-stream", ["page-a", "page-b"], [])).toBe(true);
  expect(updateEventPages("missing-stream", ["page-a"], [])).toBe(false);

  broadcastEvent("ping", { n: 1 }, "page-a");
  expect(shared.chunks.some((chunk) => chunk.includes("event: ping"))).toBe(true);

  updateEventPages("events-pages-stream", [], ["page-a", "unknown"]);
  expect(closed).toEqual(["page-a"]);

  shared.req.emit("close");
  expect(closed.sort()).toEqual(["events-pages-stream", "page-a", "page-b"]);
  expect(updateEventPages("events-pages-stream", ["page-c"], [])).toBe(false);
  off();
});
