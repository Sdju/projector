import { afterEach, expect, test, vi } from "vite-plus/test";
import { streamAgent } from "../modules/agent-core/api/client.ts";
import { streamViaEvents } from "../modules/agent-core/api/event-stream.ts";
import { pickRejoinRun } from "../modules/agent-core/api/runs.ts";

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

const turn = { chat: "c", backend: "opencode", at: 10_000, session: "s1" };
const finished = (id, startedAt, extra = {}) => ({
  id,
  backend: "opencode",
  chat: "c",
  topic: "вопрос",
  status: "done",
  startedAt,
  endedAt: startedAt + 1_000,
  session: "s1",
  ...extra,
});

test("a live run of the chat is preferred for a rejoin", () => {
  const feed = {
    runs: [{ id: "live", backend: "opencode", chat: "c", projectId: "p", topic: "вопрос" }],
    recent: [finished("old", 10_500)],
  };
  expect(pickRejoinRun(feed, turn)).toBe("live");
});

test("a finished run that started for this turn replays its answer", () => {
  const feed = { runs: [], recent: [finished("done-run", 10_500)] };
  expect(pickRejoinRun(feed, turn)).toBe("done-run");
});

test("a run of another turn, session or outcome is not replayed", () => {
  const feed = {
    runs: [],
    recent: [
      finished("older", 1_000),
      finished("other-session", 10_500, { session: "s2" }),
      finished("failed", 10_600, { status: "error" }),
    ],
  };
  expect(pickRejoinRun(feed, turn)).toBeUndefined();
  // A turn saved before `at` existed cannot tell its run from a later one of the same session.
  expect(pickRejoinRun(feed, { ...turn, at: undefined })).toBeUndefined();
  const liveOld = {
    runs: [
      {
        id: "old-live",
        backend: "opencode",
        chat: "c",
        projectId: "p",
        topic: "вопрос",
        startedAt: 100_000,
      },
    ],
    recent: [],
  };
  expect(pickRejoinRun(liveOld, turn)).toBeUndefined();
});
