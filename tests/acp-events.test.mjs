import { expect, test } from "vite-plus/test";
import {
  createAcpEventMapper,
  createAcpReplayCollector,
} from "../server/modules/agent/acp-events.ts";

const delta = (data) => ({
  sessionUpdate: "tool_call_update",
  toolCallId: "t1",
  _meta: { terminal_output_delta: { data, terminal_id: "t1" } },
});

test("command output streamed as terminal deltas becomes the tool result", () => {
  const events = [];
  const mapper = createAcpEventMapper((type, data) => events.push([type, data]), "Codex");
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call",
    toolCallId: "t1",
    title: "ls",
    status: "in_progress",
  });
  mapper.handleUpdate("s", delta("one\n"));
  mapper.handleUpdate("s", delta("two\n"));
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call_update",
    toolCallId: "t1",
    status: "completed",
  });
  expect(events.at(-1)).toEqual(["tool-result", { id: "t1", name: "ls", output: "one\ntwo\n" }]);
});

test("a failed command keeps its streamed output as the error", () => {
  const events = [];
  const mapper = createAcpEventMapper((type, data) => events.push([type, data]), "Codex");
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call",
    toolCallId: "t1",
    title: "x",
    status: "in_progress",
  });
  mapper.handleUpdate("s", delta("boom"));
  mapper.handleUpdate("s", {
    sessionUpdate: "tool_call_update",
    toolCallId: "t1",
    status: "failed",
  });
  expect(events.at(-1)[1].error).toBe("boom");
});

test("replay rebuilds output from deltas too", () => {
  const collector = createAcpReplayCollector("codex", "s");
  collector.handleUpdate({
    sessionUpdate: "tool_call",
    toolCallId: "t1",
    title: "ls",
    status: "in_progress",
  });
  collector.handleUpdate(delta("out"));
  collector.handleUpdate({
    sessionUpdate: "tool_call_update",
    toolCallId: "t1",
    status: "completed",
  });
  expect(collector.turns[0].tools[0]).toMatchObject({ status: "done", detail: "out" });
});
