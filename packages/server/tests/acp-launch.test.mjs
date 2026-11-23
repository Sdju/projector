import "../../../tests/helpers/builtins.mjs";
import { expect, test } from "vite-plus/test";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAgentLaunchOverride } from "../../core/modules/agent-launch/index.ts";
import {
  acpCommandExists,
  acpLaunchFile,
  acpLaunchRevision,
  acpLaunchSettings,
  createAcpBackend,
  isNpxCommand,
  launchOverride,
  mergeLaunchEnv,
  resetAcpLaunchOverride,
  resolveAcpLaunch,
  setAcpLaunchOverride,
} from "../modules/agents/acp/index.ts";
import { initializeAcp, startAcp } from "../modules/agents/acp/acp-process.ts";
import { registerAgentBackend } from "../modules/agent/index.ts";
import { opencodeBackend } from "../modules/agents/opencode/index.ts";

test("a launch override keeps only safe command, args and env fields", () => {
  expect(parseAgentLaunchOverride({ command: "  node  " })).toStrictEqual({ command: "node" });
  expect(parseAgentLaunchOverride({ command: "node", args: [] })).toStrictEqual({
    command: "node",
    args: [],
  });
  expect(parseAgentLaunchOverride({ env: { FOO: "bar" } })).toStrictEqual({
    env: { FOO: "bar" },
  });
  expect(parseAgentLaunchOverride({})).toBeUndefined();
  expect(() => parseAgentLaunchOverride({ command: "bad\ncommand" })).toThrow(/переводы строк/);
  expect(() => parseAgentLaunchOverride({ args: ["ok", ""] })).toThrow(/args\[1\]/);
  expect(() => parseAgentLaunchOverride({ env: { "1BAD": "x" } })).toThrow(/имя переменной/);
  expect(() => parseAgentLaunchOverride({ env: JSON.parse('{"__proto__":"x"}') })).toThrow(
    /имя переменной/,
  );
  expect(() => parseAgentLaunchOverride({ env: { FOO: 1 } })).toThrow(/должен быть строкой/);
});

test("an absolute executable is found even when the override narrows PATH, and directories are rejected", async () => {
  const directory = await mkdtemp(join(tmpdir(), "projector-acp-dir-"));
  try {
    expect(acpCommandExists(process.execPath, { PATH: "" })).toBe(true);
    expect(acpCommandExists(directory, { PATH: "" })).toBe(false);
    expect(acpCommandExists("projector-missing-command", { PATH: "" })).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("npx command detection handles wrappers and full paths", () => {
  expect(isNpxCommand("npx")).toBe(true);
  expect(isNpxCommand("npx.cmd")).toBe(true);
  expect(isNpxCommand("C:\\Program Files\\nodejs\\npx.exe")).toBe(true);
  expect(isNpxCommand("/usr/local/bin/npx")).toBe(true);
  expect(isNpxCommand("opencode")).toBe(false);
});

test("mergeLaunchEnv overrides case-variant keys on Windows", () => {
  const merged = mergeLaunchEnv({ Path: "C:\\old", KEEP: "1" }, { PATH: "C:\\new", ADD: "2" });
  expect(merged.PATH).toBe("C:\\new");
  expect(merged.KEEP).toBe("1");
  expect(merged.ADD).toBe("2");
  if (process.platform === "win32") expect("Path" in merged).toBe(false);
});

test("the override wins over a preferred binary, and args alone layer on the default", () => {
  const program = {
    id: "fixture",
    label: "Fixture",
    command: "npx",
    args: ["-y", "fixture-package"],
    binary: "fixture-bin",
    binaryArgs: ["acp"],
  };
  expect(
    resolveAcpLaunch(program, undefined, (command) => command === "fixture-bin"),
  ).toStrictEqual({ command: "fixture-bin", args: ["acp"], source: "binary" });
  expect(resolveAcpLaunch(program, undefined, () => false)).toStrictEqual({
    command: "npx",
    args: ["-y", "fixture-package"],
    source: "default",
  });
  expect(resolveAcpLaunch(program, { command: "/opt/fixture" }, () => true)).toStrictEqual({
    command: "/opt/fixture",
    args: ["-y", "fixture-package"],
    source: "override",
  });
  expect(
    resolveAcpLaunch(program, { command: "C:\\tools\\fixture-bin.exe" }, () => true),
  ).toStrictEqual({
    command: "C:\\tools\\fixture-bin.exe",
    args: ["acp"],
    source: "override",
  });
  expect(
    resolveAcpLaunch(program, { command: "/opt/fixture", args: [] }, () => true),
  ).toStrictEqual({
    command: "/opt/fixture",
    args: [],
    source: "override",
  });
  expect(resolveAcpLaunch(program, { args: ["acp"] }, () => false)).toStrictEqual({
    command: "npx",
    args: ["acp"],
    source: "default",
  });
});

test("launch settings are saved per machine and reset to the descriptor", async () => {
  const directory = await mkdtemp(join(tmpdir(), "projector-acp-launch-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
  try {
    const file = acpLaunchFile();
    expect(file).toBe(join(directory, "projector", "agent", "launch.json"));
    await expect(setAcpLaunchOverride("nobody", { command: "node" })).rejects.toThrow(
      /Неизвестный ACP-агент/,
    );

    const override = {
      command: process.execPath,
      args: ["acp"],
      env: { PROJECTOR_TEST_LAUNCH: "1", PATH: "" },
    };
    const beforeRev = acpLaunchRevision();
    await setAcpLaunchOverride("opencode", override);
    expect(acpLaunchRevision()).not.toBe(beforeRev);
    expect(launchOverride("opencode")).toStrictEqual(override);

    const stored = JSON.parse(await readFile(file, "utf8"));
    expect(stored.version).toBe(1);
    expect(stored.agents.opencode).toStrictEqual(override);

    const state = acpLaunchSettings().agents.find((agent) => agent.id === "opencode");
    expect(state.override).toStrictEqual(override);
    expect(state.effective).toMatchObject({
      command: process.execPath,
      source: "override",
      found: true,
      path: process.execPath,
    });
    expect(opencodeBackend.available()).toBe(true);
    expect(opencodeBackend.terminal.executable).toBe(process.execPath);

    await resetAcpLaunchOverride("opencode");
    expect(launchOverride("opencode")).toBeUndefined();
    expect(JSON.parse(await readFile(file, "utf8")).agents.opencode).toBeUndefined();
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("startAcp applies the machine override command, args, env and project cwd", async () => {
  const directory = await mkdtemp(join(tmpdir(), "projector-acp-spawn-"));
  const project = await mkdtemp(join(tmpdir(), "projector-acp-project-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
  const backendId = "fixture-acp-spawn";
  registerAgentBackend(
    createAcpBackend({
      id: backendId,
      label: "Fixture Launch",
      command: "missing-default-command",
      args: ["acp"],
    }),
  );
  const script = `
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\\n")) !== -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              protocolVersion: 1,
              authMethods: [{ id: process.env.FIXTURE_LAUNCH_MARK + "|" + process.cwd() + "|" + process.argv.slice(2).join(",") }],
            },
          }) + "\\n");
        }
      }
    });
  `;
  const scriptFile = join(directory, "mock-acp.mjs");
  await writeFile(scriptFile, script, "utf8");
  try {
    await setAcpLaunchOverride(backendId, {
      command: process.execPath,
      args: [scriptFile, "--flag-from-override"],
      env: { FIXTURE_LAUNCH_MARK: "override-ok" },
    });
    const connection = await startAcp(backendId, project, {
      onNotification() {},
      onRequest: () => ({}),
    });
    try {
      const init = await initializeAcp(connection, backendId);
      expect(init.authMethods?.[0]?.id).toBe(`override-ok|${project}|--flag-from-override`);
    } finally {
      await connection.close();
    }
  } finally {
    await resetAcpLaunchOverride(backendId);
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(directory, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
  }
});

test("the launch API reads, writes and resets only for a local page", async () => {
  const directory = await mkdtemp(join(tmpdir(), "projector-acp-launch-api-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
  const { handleApi } = await import("../app/api.ts");
  const server = createServer((req, res) => {
    void handleApi(req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const list = await fetch(`${base}/api/agent/launch`, { headers: { Origin: base } });
    expect(list.status).toBe(200);
    expect((await list.json()).agents.some((agent) => agent.id === "opencode")).toBe(true);

    const saved = await fetch(`${base}/api/agent/launch/opencode`, {
      method: "PUT",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ command: process.execPath, args: ["acp"] }),
    });
    expect(saved.status).toBe(200);
    const state = await saved.json();
    expect(state.agents.find((agent) => agent.id === "opencode").override).toMatchObject({
      command: process.execPath,
      args: ["acp"],
    });

    const foreign = await fetch(`${base}/api/agent/launch/opencode`, {
      method: "PUT",
      headers: { Origin: "https://foreign.example", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(foreign.status).toBe(403);

    const reset = await fetch(`${base}/api/agent/launch/opencode`, {
      method: "DELETE",
      headers: { Origin: base },
    });
    expect(reset.status).toBe(200);
    expect((await reset.json()).agents.find((agent) => agent.id === "opencode").override).toBe(
      undefined,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
