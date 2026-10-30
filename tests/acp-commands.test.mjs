import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vite-plus/test";
import { registerAcpProgram } from "../server/modules/agents/acp/acp-programs.ts";
import { acpCommands } from "../server/modules/agents/acp/acp-tools.ts";

/** A file, not an `-e` argument: Windows shell quoting would mangle the multi-line script. */
const SCRIPT = fileURLToPath(new URL("./fixtures/acp-commands-probe.mjs", import.meta.url));

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
    args: [SCRIPT, mode],
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
