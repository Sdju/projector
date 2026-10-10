import { expect, test } from "vite-plus/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createState } from "../src/modules/agent/model/chat-state.ts";
import { useChatActions } from "../src/modules/agent/model/chat-actions.ts";
import { addVersion } from "../src/modules/agent/model/branches.ts";
import { configuredMcpServers, projectMcpServers } from "../server/modules/agent/mcp-config.ts";

const turn = (id, role, extra = {}) => ({ id, role, text: id, tools: [], ...extra });

function chat(turns) {
  const state = createState();
  state.turns = turns;
  const sent = [];
  const actions = useChatActions(state, {
    backend: "claude-code",
    projectId: "p",
    ready: Promise.resolve(),
    persist: () => {},
    send: async (text) => void sent.push(text),
    stop: () => {},
  });
  return { state, actions, sent };
}

test("editing a message changes nothing until the new one is sent", () => {
  const { state, actions } = chat([
    turn("u1", "user"),
    turn("a1", "assistant", { tail: "t1" }),
    turn("u2", "user", { content: [{ type: "text", text: "second" }] }),
    turn("a2", "assistant", { tail: "t2" }),
  ]);
  actions.edit("u2");
  expect(state.editing).toBe("u2");
  expect(state.draft).toBe("u2");
  expect(state.turns.map((item) => item.id)).toEqual(["u1", "a1", "u2", "a2"]);

  actions.cancelEdit();
  expect(state.editing).toBe("");
  expect(state.draft).toBe("");
  expect(state.turns).toHaveLength(4);

  actions.edit("u2");
  actions.applyEdit();
  expect(state.turns.map((item) => item.id)).toEqual(["u1", "a1"]);
  expect(state.stash.index).toBe(2);
  expect(state.stash.versions[0].map((item) => item.id)).toEqual(["u2", "a2"]);

  const replacement = turn("u3", "user");
  addVersion(replacement, state.stash.versions);
  expect(replacement.variants).toHaveLength(1);
});

test("a busy chat cannot start an edit", () => {
  const { state, actions } = chat([turn("u1", "user"), turn("a1", "assistant")]);
  state.busy = true;
  actions.edit("u1");
  expect(state.editing).toBe("");
});

test("remote MCP servers go only to agents that support them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "projector-mcp-"));
  process.env.MCP_TEST_TOKEN = "secret";
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          local: { command: "node", args: ["s.js", "${MCP_TEST_TOKEN}"], env: { A: "${NOPE:-x}" } },
          web: {
            type: "http",
            url: "https://example.test/mcp",
            headers: { Authorization: "Bearer ${MCP_TEST_TOKEN}" },
          },
          events: { type: "sse", url: "https://example.test/sse" },
        },
      }),
    );
    expect((await projectMcpServers(dir)).map((server) => server.name)).toEqual(["local"]);
    const all = await projectMcpServers(dir, { http: true });
    expect(all.map((server) => server.name)).toEqual(["local", "web"]);
    expect(all[0]).toMatchObject({ args: ["s.js", "secret"], env: [{ name: "A", value: "x" }] });
    expect(all[1]).toMatchObject({
      type: "http",
      headers: [{ name: "Authorization", value: "Bearer secret" }],
    });
    expect((await configuredMcpServers(dir)).map((server) => server.status)[1]).toContain("http");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
