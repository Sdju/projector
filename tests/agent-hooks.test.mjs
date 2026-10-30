import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  loadHooks,
  listHooks,
  runStopHooks,
  withHooks,
  writeUserHooks,
} from "../server/modules/agents/projector/projector-hooks.ts";

let previous;
let data;
beforeEach(async () => {
  previous = process.env.XDG_DATA_HOME;
  data = await mkdtemp(join(tmpdir(), "projector-hooks-"));
  process.env.XDG_DATA_HOME = data;
});
afterEach(() => {
  if (previous === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previous;
});

const configure = async (hooks) => {
  await mkdir(join(data, "projector", "agent"), { recursive: true });
  await writeFile(join(data, "projector", "agent", "hooks.json"), JSON.stringify({ hooks }));
};
const echo = tool({
  description: "echo",
  inputSchema: z.object({ text: z.string() }),
  execute: async ({ text }) => `got ${text}`,
});

/** Hooks run through the platform shell; a Node one-liner avoids POSIX-only commands. */
const nodeCommand = (script) => `"${process.execPath}" -e "${script}"`;

describe("hooks of the Projector agent", () => {
  it("reads only well-formed hooks from the user's file", async () => {
    expect(await loadHooks()).toEqual([]);
    await configure({
      Stop: [{ command: "true", minSeconds: 5 }, { command: "" }, { nope: 1 }],
      PreToolUse: [
        { command: "true", matcher: "(" },
        { command: "true", matcher: "^echo$" },
      ],
    });
    const hooks = await loadHooks();
    expect(hooks.map((item) => item.event)).toEqual(["PreToolUse", "Stop"]);
    expect(hooks[1].minSeconds).toBe(5);
  });

  it("lets exit code 2 of PreToolUse forbid the call, with the reason", async () => {
    await configure({
      PreToolUse: [
        {
          matcher: "^echo$",
          command: nodeCommand("process.stderr.write('nope');process.exit(2)"),
        },
      ],
    });
    const tools = withHooks({ echo, other: echo }, await loadHooks(), data);
    await expect(tools.echo.execute({ text: "a" }, {})).rejects.toThrow(/Хук запретил.*nope/);
    expect(await tools.other.execute({ text: "a" }, {})).toBe("got a");
  });

  it("runs PostToolUse with the call on its input, and an ordinary failure forbids nothing", async () => {
    const log = join(data, "post.log");
    process.env.PROJECTOR_HOOK_LOG = log;
    try {
      await configure({
        PreToolUse: [{ command: "exit 1" }],
        PostToolUse: [
          {
            command: nodeCommand(
              "const fs=require('fs');let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>fs.writeFileSync(process.env.PROJECTOR_HOOK_LOG,s));",
            ),
          },
        ],
      });
      const tools = withHooks({ echo }, await loadHooks(), data);
      expect(await tools.echo.execute({ text: "b" }, {})).toBe("got b");
      const seen = JSON.parse(await readFile(log, "utf8"));
      expect(seen).toMatchObject({ event: "PostToolUse", tool: "echo", input: { text: "b" } });
    } finally {
      delete process.env.PROJECTOR_HOOK_LOG;
    }
  });

  it("takes a JSON answer: block with a reason, or context added to the result", async () => {
    await configure({
      PreToolUse: [
        {
          command: nodeCommand(
            "process.stdout.write(JSON.stringify({decision:'block',reason:'not now'}))",
          ),
        },
      ],
    });
    let tools = withHooks({ echo }, await loadHooks(), data);
    await expect(tools.echo.execute({ text: "a" }, {})).rejects.toThrow(/not now/);
    await configure({
      PostToolUse: [
        {
          command: nodeCommand(
            "process.stdout.write(JSON.stringify({additionalContext:'remember'}))",
          ),
        },
      ],
    });
    tools = withHooks({ echo }, await loadHooks(), data);
    expect(await tools.echo.execute({ text: "a" }, {})).toEqual({
      result: "got a",
      hook: "remember",
    });
  });

  it("asks before the project's hooks and leaves them out when refused", async () => {
    const project = await mkdtemp(join(tmpdir(), "projector-hooks-project-"));
    await mkdir(join(project, ".projector"));
    await writeFile(
      join(project, ".projector", "hooks.json"),
      JSON.stringify({ hooks: { Stop: [{ command: "echo hi" }] } }),
    );
    expect((await listHooks(project)).map((item) => item.source)).toEqual(["project"]);
    const asked = [];
    const guard = (answer) => ({
      cwd: project,
      trusting: false,
      approve: async (request) => (asked.push(request), answer),
    });
    expect(await loadHooks(project, guard(false))).toEqual([]);
    expect(asked).toHaveLength(1);
    expect(await loadHooks(project, guard(true))).toHaveLength(1);
    // "Always" is remembered for these commands, and a changed file asks again.
    expect(await loadHooks(project, guard("always"))).toHaveLength(1);
    const count = asked.length;
    expect(await loadHooks(project, guard(false))).toHaveLength(1);
    expect(asked).toHaveLength(count);
    await writeFile(
      join(project, ".projector", "hooks.json"),
      JSON.stringify({ hooks: { Stop: [{ command: "echo changed" }] } }),
    );
    expect(await loadHooks(project, guard(false))).toEqual([]);
    expect(asked).toHaveLength(count + 1);
    await writeFile(
      join(project, ".projector", "hooks.json"),
      JSON.stringify({ hooks: { Stop: [{ command: "echo hi" }] } }),
    );
    expect(await loadHooks(project, { cwd: project, trusting: true })).toHaveLength(1);
    expect(await loadHooks(project)).toEqual([]);
  });

  it("checks the file before saving it", async () => {
    await expect(writeUserHooks("{")).rejects.toThrow(/Не JSON/);
    await expect(writeUserHooks("{}")).rejects.toThrow(/hooks/);
    await expect(writeUserHooks('{"hooks":{"Start":[]}}')).rejects.toThrow(/Неизвестное/);
    await expect(writeUserHooks('{"hooks":{"Stop":[{}]}}')).rejects.toThrow(/command/);
    await expect(
      writeUserHooks('{"hooks":{"Stop":[{"command":"x","matcher":"("}]}}'),
    ).rejects.toThrow(/matcher/);
    await writeUserHooks('{"hooks":{"Stop":[{"command":"x"}]}}');
    expect(await loadHooks()).toHaveLength(1);
    await writeUserHooks("");
    expect(await loadHooks()).toEqual([]);
  });

  it("runs Stop only for turns that lasted long enough", async () => {
    const log = join(data, "stop.log");
    await configure({ Stop: [{ command: `echo done >> ${JSON.stringify(log)}`, minSeconds: 10 }] });
    const hooks = await loadHooks();
    await runStopHooks(hooks, data, { seconds: 3, text: "" });
    await expect(readFile(log, "utf8")).rejects.toThrow();
    await runStopHooks(hooks, data, { seconds: 12, text: "x" });
    expect((await readFile(log, "utf8")).trim()).toBe("done");
  });
});
