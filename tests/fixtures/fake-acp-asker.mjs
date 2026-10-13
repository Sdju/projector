// A minimal ACP agent: on a prompt it asks the user a question the way the program named in
// FAKE_ACP_ASK does, then repeats the user's answer as its reply.
import { createInterface } from "node:readline";

const kind = process.env.FAKE_ACP_ASK;
const send = (message) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
const waiting = new Map();
let counter = 0;
const call = (method, params) =>
  new Promise((resolve) => {
    const id = `agent-${++counter}`;
    waiting.set(id, resolve);
    send({ id, method, params });
  });

createInterface({ input: process.stdin }).on("line", async (line) => {
  const message = JSON.parse(line);
  if (message.method === undefined) {
    waiting.get(message.id)?.(message);
    waiting.delete(message.id);
    return;
  }
  const reply = (result) => send({ id: message.id, result });
  if (message.method === "initialize") {
    process.stderr.write(`caps:${JSON.stringify(message.params.clientCapabilities)}\n`);
    return reply({ protocolVersion: 1, agentCapabilities: {} });
  }
  if (message.method === "session/new") return reply({ sessionId: "s1" });
  if (message.method !== "session/prompt") return reply({});
  const response =
    kind === "cursor"
      ? await call("cursor/ask_question", {
          toolCallId: "t1",
          title: "Pick",
          questions: [
            {
              id: "c",
              prompt: "Which color?",
              options: [
                { id: "r", label: "Red" },
                { id: "g", label: "Green" },
              ],
            },
          ],
        })
      : await call("elicitation/create", {
          sessionId: "s1",
          mode: "form",
          message: "Questions",
          requestedSchema: {
            type: "object",
            properties: {
              q0: {
                type: "string",
                title: "Which color?",
                oneOf: [
                  { const: "Red", title: "Red" },
                  { const: "Green", title: "Green" },
                ],
              },
              q0_custom: { type: "string", title: "other" },
            },
            required: [],
          },
        });
  send({
    method: "session/update",
    params: {
      sessionId: "s1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: JSON.stringify(response.result ?? response.error) },
      },
    },
  });
  reply({ stopReason: "end_turn" });
});
