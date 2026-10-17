import { expect, test } from "vite-plus/test";
import { createOpencodeDialect } from "../server/modules/agents/opencode/dialect.ts";
import { createAcpEventMapper } from "../server/modules/agents/acp/acp-events.ts";
import { createClaudeEventMapper } from "../server/modules/agents/claude-code/claude-code-events.ts";
import { applyAgentEvent } from "../src/modules/agent/model/turn-events.ts";

const thoughts = (events) =>
  events.filter(([type]) => type === "thought").map(([, data]) => data.text);

test("reasoning chunks of an ACP agent become thoughts, a subagent's stay out", () => {
  const events = [];
  const mapper = createAcpEventMapper(
    (type, data) => events.push([type, data]),
    "OpenCode",
    createOpencodeDialect(),
  );
  const chunk = (text, _meta) => ({
    sessionUpdate: "agent_thought_chunk",
    content: { type: "text", text },
    _meta,
  });
  mapper.handleUpdate("s", chunk("Нужно "));
  mapper.handleUpdate("s", chunk("подумать"));
  mapper.handleUpdate("s", chunk("inner", { "opencode/child-session": { id: "c", title: "t" } }));
  expect(thoughts(events)).toEqual(["Нужно ", "подумать"]);
});

test("Claude Code thinking is streamed once, not again with the whole message", () => {
  const events = [];
  const mapper = createClaudeEventMapper((type, data) => events.push([type, data]));
  const stream = (event) => ({ type: "stream_event", event, parent_tool_use_id: null });
  mapper.handle(stream({ type: "message_start", message: { id: "m1" } }));
  mapper.handle(
    stream({ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "шаг 1" } }),
  );
  mapper.handle({
    type: "assistant",
    parent_tool_use_id: null,
    message: { id: "m1", content: [{ type: "thinking", thinking: "шаг 1" }] },
  });
  mapper.handle({
    type: "assistant",
    parent_tool_use_id: null,
    message: { id: "m2", content: [{ type: "thinking", thinking: "без стрима" }] },
  });
  mapper.handle({
    type: "assistant",
    parent_tool_use_id: "sub",
    message: { id: "m3", content: [{ type: "thinking", thinking: "субагент" }] },
  });
  expect(thoughts(events)).toEqual(["шаг 1", "без стрима"]);
});

test("thoughts join into one part and stay out of the answer text", () => {
  const state = { permissions: [], questions: [] };
  const turn = { id: "t", role: "assistant", text: "", tools: [] };
  const apply = (event, data) => applyAgentEvent(state, turn, { event, data }, () => {});
  apply("thought", { text: "а" });
  apply("thought", { text: "б" });
  apply("tool", { id: "x", name: "ls", input: {} });
  apply("thought", { text: "в" });
  apply("text", { text: "ответ" });
  expect(turn.text).toBe("ответ");
  expect(turn.parts).toEqual([
    { type: "thought", text: "аб" },
    { type: "tool", id: "x" },
    { type: "thought", text: "в" },
    { type: "text", text: "ответ" },
  ]);
});
