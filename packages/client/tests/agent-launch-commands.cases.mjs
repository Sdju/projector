import { afterEach, expect, test, vi } from "vite-plus/test";
import { registerLaunchCommands } from "../modules/agent/model/launch-commands.ts";
import { envFromText } from "../modules/agent/modules/settings/model/launch-settings.ts";

const commands = new Map();
registerLaunchCommands((id, _title, run, _enabled, _requires, meta) =>
  commands.set(id, { run, meta }),
);

afterEach(() => vi.unstubAllGlobals());

const state = {
  file: "/tmp/projector/agent/launch.json",
  agents: [
    {
      id: "opencode",
      label: "OpenCode",
      default: { command: "opencode", args: ["acp"], source: "default" },
      effective: {
        command: "opencode",
        args: ["acp"],
        source: "default",
        found: true,
        path: "/bin/opencode",
      },
    },
  ],
};

function stubLaunch() {
  const requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      requests.push({ url: String(url), method: init?.method ?? "GET", body: init?.body });
      return { ok: true, json: async () => JSON.parse(JSON.stringify(state)) };
    }),
  );
  return requests;
}

test("the environment text accepts comments and empty values but not unsafe names", () => {
  expect(envFromText("FOO=1\n# note\nBAR=")).toStrictEqual({ FOO: "1", BAR: "" });
  expect(() => envFromText("__proto__=x")).toThrow(/некорректное имя/);
  expect(() => envFromText("BAD NAME=x")).toThrow(/некорректное имя/);
  expect(() => envFromText("FOO=1\nFOO=2")).toThrow(/дважды/);
});

test("launch commands are registered with agent descriptions", () => {
  expect([...commands.keys()]).toEqual([
    "ide.agent.launch.list",
    "ide.agent.launch.set",
    "ide.agent.launch.reset",
    "ide.agent.launch.check",
  ]);
  for (const { meta } of commands.values()) expect(meta.description.length).toBeGreaterThan(30);
});

test("the list and check commands read the machine settings", async () => {
  const requests = stubLaunch();
  expect(await commands.get("ide.agent.launch.list").run()).toStrictEqual(state);
  expect(await commands.get("ide.agent.launch.check").run({ backend: "opencode" })).toStrictEqual(
    state.agents[0],
  );
  expect(requests.map((request) => request.method)).toEqual(["GET", "GET"]);
});

test("set sends an argv override and reset removes it", async () => {
  const requests = stubLaunch();
  await commands.get("ide.agent.launch.set").run({
    backend: "opencode",
    command: "/opt/opencode",
    args: ["acp"],
    env: { OPENCODE_CONFIG: "/tmp/config" },
  });
  expect(requests[0]).toMatchObject({ method: "PUT", url: "/api/agent/launch/opencode" });
  expect(JSON.parse(requests[0].body)).toStrictEqual({
    command: "/opt/opencode",
    args: ["acp"],
    env: { OPENCODE_CONFIG: "/tmp/config" },
  });

  await commands.get("ide.agent.launch.reset").run({ backend: "opencode" });
  expect(requests[1]).toMatchObject({ method: "DELETE", url: "/api/agent/launch/opencode" });
});

test("a launch command without an agent or with invalid field types is refused", () => {
  const requests = stubLaunch();
  expect(() => commands.get("ide.agent.launch.set").run({ command: "node" })).toThrow(/backend/);
  expect(() =>
    commands.get("ide.agent.launch.set").run({ backend: "opencode", command: 123 }),
  ).toThrow(/строкой/);
  expect(() =>
    commands.get("ide.agent.launch.set").run({ backend: "opencode", args: ["acp", 123] }),
  ).toThrow(/args\[1\]/);
  expect(() =>
    commands.get("ide.agent.launch.set").run({ backend: "opencode", env: "FOO=1" }),
  ).toThrow(/объектом/);
  expect(requests).toEqual([]);
});
