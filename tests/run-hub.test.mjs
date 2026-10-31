import { expect, test } from "vite-plus/test";
import {
  createApprovalBridge,
  createCommandBridge,
  completeCommandRequest,
  isBridgeRequestPending,
} from "../server/modules/agent/command-bridge.ts";
import { driveRun, isRunDriven, joinRun } from "../server/modules/agent/run-hub.ts";

// Each test uses its own run id: the hub is kept across module reloads, like the server's other state.
let counter = 0;
const runId = () => `hub-test-${Date.now().toString(16)}-${counter++}`;

function viewer(key) {
  const events = [];
  return {
    events,
    key,
    closed: 0,
    emit(event, data) {
      events.push({ event, data });
    },
    close() {
      this.closed++;
    },
  };
}

const names = (list) => list.map((item) => item.event);
const of = (list, event) => list.filter((item) => item.event === event);

test("a page that joins a driven run gets the answer so far and then the live events", () => {
  const id = runId();
  const owner = viewer();
  const driver = driveRun(id, owner);
  driver.publish("run", { id });
  driver.publish("text", { text: "one" });

  const second = viewer();
  const leave = joinRun(id, second);
  expect(leave).toBeTypeOf("function");
  expect(names(second.events)).toEqual(["run", "text"]);
  expect(second.events[1].data).toEqual({ text: "one" });

  driver.publish("text", { text: "two" });
  expect(of(owner.events, "text").map((item) => item.data.text)).toEqual(["one", "two"]);
  expect(of(second.events, "text").map((item) => item.data.text)).toEqual(["one", "two"]);

  driver.finish();
  expect(owner.closed).toBe(1);
  expect(second.closed).toBe(1);
  expect(isRunDriven(id)).toBe(false);
  expect(joinRun(id, viewer())).toBeUndefined();
});

test("a command is asked of one page, and the next viewer takes it when that page leaves", async () => {
  const id = runId();
  const owner = viewer();
  const driver = driveRun(id, owner);

  let request;
  const controller = new AbortController();
  const commands = createCommandBridge((_event, data) => (request = data), controller.signal);
  void commands({ operation: "execute", command: "ls" });
  expect(isBridgeRequestPending(request.id)).toBe(true);
  driver.publish("command-request", request);
  expect(of(owner.events, "command-request")).toHaveLength(1);

  const second = viewer();
  joinRun(id, second);
  expect(of(second.events, "command-request")).toHaveLength(0);

  // The owner page is gone: the same unanswered command goes to the page that keeps watching.
  driver.leave();
  expect(of(second.events, "command-request")).toHaveLength(1);
  expect(second.events.at(-1).data.id).toBe(request.id);

  // Answered requests are not replayed to pages that join later.
  completeCommandRequest(request.id, { output: "ok" });
  expect(isBridgeRequestPending(request.id)).toBe(false);
  const third = viewer();
  joinRun(id, third);
  expect(of(third.events, "command-request")).toHaveLength(0);
  driver.finish();
});

test("a late page sees an unanswered permission prompt and not an answered one", async () => {
  const id = runId();
  const driver = driveRun(id, viewer());

  let asked;
  const controller = new AbortController();
  const approve = createApprovalBridge((_event, data) => (asked = data), controller.signal);
  void approve({ tool: "Bash", input: { command: "ls" }, title: "ls" });
  driver.publish("permission-request", asked);

  const second = viewer();
  joinRun(id, second);
  expect(of(second.events, "permission-request")).toHaveLength(1);

  completeCommandRequest(asked.id, { output: { allow: true } });
  const third = viewer();
  joinRun(id, third);
  expect(of(third.events, "permission-request")).toHaveLength(0);
  driver.finish();
});

test("a reconnecting page replaces its old subscription and keeps the run's commands", () => {
  const id = runId();
  const first = viewer("page-a");
  const driver = driveRun(id, first);
  driver.publish("text", { text: "one" });

  const again = viewer("page-a");
  joinRun(id, again);
  driver.publish("text", { text: "two" });
  expect(of(first.events, "text").map((item) => item.data.text)).toEqual(["one"]);
  expect(of(again.events, "text").map((item) => item.data.text)).toEqual(["one", "two"]);
  driver.finish();
  expect(first.closed).toBe(0);
  expect(again.closed).toBe(1);
});

test("delivery is noted only while someone is watching", () => {
  const id = runId();
  const driver = driveRun(id, viewer());
  driver.leave();
  driver.publish("done", { text: "x" });
  expect(driver.delivered()).toBe(false);

  const other = runId();
  const second = driveRun(other, viewer());
  second.publish("done", { text: "x" });
  expect(second.delivered()).toBe(true);
  second.finish();
});
