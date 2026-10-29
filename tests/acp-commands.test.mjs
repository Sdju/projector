import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { registerAcpProgram } from "../server/modules/agents/acp/acp-programs.ts";
import { acpCommands } from "../server/modules/agents/acp/acp-tools.ts";

const SCRIPT = `
  const fs = require("node:fs");
  const readline = require("node:readline");
  const mode = process.argv[1];
  if (process.env.PROBE_MARK) fs.appendFileSync(process.env.PROBE_MARK, "start\\n");
  const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
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
`;

const dirs = [];
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop(), { recursive: true, force: true });
  delete process.env.PROBE_MARK;
});

let nextId = 1;
function probe(mode) {
  const id = `probe-${nextId++}`;
  registerAcpProgram({
    id,
    label: "Probe",
    command: process.execPath,
    args: ["-e", SCRIPT, mode],
  });
  return id;
}

const expected = [
  { name: "review", description: "Review changes", hint: "<branch>" },
  { name: "compact" },
];

test("ACP commands are read from the notification sent before session/new's response", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "projector-acp-commands-"));
  dirs.push(cwd);
  expect(await acpCommands(probe("before"), cwd, 1000)).toStrictEqual(expected);
});

test("ACP commands are read when the notification follows session/new's response", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "projector-acp-commands-"));
  dirs.push(cwd);
  expect(await acpCommands(probe("after"), cwd, 1000)).toStrictEqual(expected);
});

test("an empty first snapshot does not hide the commands sent right after", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "projector-acp-commands-"));
  dirs.push(cwd);
  expect(await acpCommands(probe("empty-then"), cwd, 1000)).toStrictEqual(expected);
});

test("ACP commands come from a v2 session/new response when the agent sends them there", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "projector-acp-commands-"));
  dirs.push(cwd);
  expect(await acpCommands(probe("response"), cwd, 1000)).toStrictEqual(expected);
});

test("an agent that advertises nothing yields an empty list instead of blocking", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "projector-acp-commands-"));
  dirs.push(cwd);
  expect(await acpCommands(probe("none"), cwd, 100)).toStrictEqual([]);
});

test("the command list is cached, so opening another chat does not spawn the agent again", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "projector-acp-commands-"));
  dirs.push(cwd);
  const mark = join(cwd, "mark");
  process.env.PROBE_MARK = mark;
  const id = probe("before");
  await acpCommands(id, cwd, 1000);
  await acpCommands(id, cwd, 1000);
  expect((await readFile(mark, "utf8")).trim().split("\n")).toStrictEqual(["start"]);
});
