import fs from "node:fs";
import readline from "node:readline";

const mode = process.argv[2];
if (process.env.PROBE_MARK) fs.appendFileSync(process.env.PROBE_MARK, "start\n");
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const commands = [
  { name: "review", description: "Review changes", input: { hint: "<branch>" } },
  { name: "compact" },
];
const announce = () =>
  send({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "s1",
      update: { sessionUpdate: "available_commands_update", availableCommands: commands },
    },
  });
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize")
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: { sessionCapabilities: { delete: {} } },
      },
    });
  else if (message.method === "session/new") {
    if (mode === "before") {
      announce();
      send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "s1" } });
    } else if (mode === "after") {
      send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "s1" } });
      setTimeout(announce, 20);
    } else if (mode === "empty-then") {
      send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "s1" } });
      send({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "s1",
          update: { sessionUpdate: "available_commands_update", availableCommands: [] },
        },
      });
      setTimeout(announce, 30);
    } else if (mode === "response") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: { sessionId: "s1", availableCommands: commands },
      });
    } else send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "s1" } });
  } else if (message.method === "session/delete" || message.method === "session/close")
    send({ jsonrpc: "2.0", id: message.id, result: {} });
  else
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: "Method not found" },
    });
});
