import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  loadHooks,
  runStopHooks,
  withHooks,
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
      PreToolUse: [{ matcher: "^echo$", command: "echo nope >&2; exit 2" }],
    });
    const tools = withHooks({ echo, other: echo }, await loadHooks(), data);
    await expect(tools.echo.execute({ text: "a" }, {})).rejects.toThrow(/Хук запретил.*nope/);
    expect(await tools.other.execute({ text: "a" }, {})).toBe("got a");
  });

  it("runs PostToolUse with the call on its input, and an ordinary failure forbids nothing", async () => {
    const log = join(data, "post.log");
    await configure({
      PreToolUse: [{ command: "exit 1" }],
      PostToolUse: [{ command: `cat > ${JSON.stringify(log)}` }],
    });
    const tools = withHooks({ echo }, await loadHooks(), data);
    expect(await tools.echo.execute({ text: "b" }, {})).toBe("got b");
    const seen = JSON.parse(await readFile(log, "utf8"));
    expect(seen).toMatchObject({ event: "PostToolUse", tool: "echo", input: { text: "b" } });
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
