import { afterEach, expect, test, vi } from "vite-plus/test";
import { streamAgent } from "../packages/client/modules/agent-core/api/client.ts";
import { streamViaEvents } from "../packages/client/modules/agent-core/api/event-stream.ts";

afterEach(() => vi.unstubAllGlobals());

test("the run id arrives before the first event of the page stream", async () => {
  const page = new EventTarget();
  vi.stubGlobal("window", page);
  let sent;
  vi.stubGlobal("fetch", async (_url, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ accepted: true, run: "r1" }), { status: 202 });
  });
  const runs = [];
  const answer = streamViaEvents(
    { message: "hi" },
    async () => {},
    undefined,
    (id) => runs.push(id),
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  page.dispatchEvent(
    new CustomEvent("projector:agent", {
      detail: { stream: sent.stream, event: "end", data: {} },
    }),
  );
  await answer;
  expect(runs).toEqual(["r1"]);
});

test("an answer in the response body keeps the run from its header", async () => {
  vi.stubGlobal("window", new EventTarget());
  let call = 0;
  vi.stubGlobal("fetch", async () => {
    call += 1;
    // No page events stream: the server tells the page to take the answer in the body instead.
    if (call === 1) return new Response("{}", { status: 409 });
    return new Response("", { status: 200, headers: { "X-Agent-Run": "r2" } });
  });
  const runs = [];
  await streamAgent("hi", [], () => {}, undefined, { onRun: (id) => runs.push(id) });
  expect(runs).toEqual(["r2"]);
});
