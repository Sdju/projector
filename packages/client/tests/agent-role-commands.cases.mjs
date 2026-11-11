import { afterEach, expect, test, vi } from "vite-plus/test";
import { registerBuiltinClientAgents } from "../app/agents.ts";
import { registerRoleCommands } from "../modules/agent/model/role-commands.ts";
import { focusedRoleId } from "../modules/agent-roles/index.ts";
import { projectSettingsSection } from "../modules/catalog/index.ts";
import { appSettingsSection } from "../modules/settings/index.ts";

registerBuiltinClientAgents();

const commands = new Map();
const opened = [];
registerRoleCommands(
  (id, _title, run, _enabled, _requires, meta) => commands.set(id, { run, meta }),
  "p1",
  { executeCommand: async (...args) => opened.push(args) },
);

const reply = (body, ok = true) => ({ ok, json: async () => body });
const globalRole = {
  id: "role-g",
  name: "Reviewer",
  kind: "chat",
  agent: "projector",
  selection: {},
  inherited: false,
};
const projectRole = {
  id: "role-p",
  name: "Project reviewer",
  kind: "chat",
  agent: "projector",
  selection: {},
  inherited: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
  opened.length = 0;
  focusedRoleId.value = "";
  appSettingsSection.value = "interface";
  projectSettingsSection.value = "general";
});

function stubRoles({ global = [globalRole], project = [], trusted = false } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      const href = String(url);
      if (href.startsWith("/api/agent/roles")) return reply({ roles: global, file: "/tmp/r.json" });
      if (href.includes("/api/agent/project-roles"))
        return reply({
          projectId: "p1",
          path: "/p",
          file: "/p/.projector/roles.json",
          exists: project.length > 0,
          trusted,
          roles: project,
        });
      return reply({}, false);
    }),
  );
}

test("the role commands are registered with descriptions for the agent", () => {
  for (const { meta } of commands.values()) expect(meta.description.length).toBeGreaterThan(20);
});

test("edit opens Projector settings for a global chat role", async () => {
  stubRoles();
  const result = await commands.get("ide.agent.role.edit").run({ role: "role-g" });
  expect(result).toMatchObject({ role: "role-g", source: "global" });
  expect(appSettingsSection.value).toBe("agent-roles");
  expect(focusedRoleId.value).toBe("role-g");
  expect(opened).toEqual([["ide.workbench.settings.open", undefined, { scope: "editor:p1" }]]);
});

test("edit opens project settings for a trusted project role", async () => {
  stubRoles({ project: [projectRole], trusted: true });
  const result = await commands.get("ide.agent.role.edit").run({ role: "role-p" });
  expect(result).toMatchObject({ role: "role-p", source: "project" });
  expect(projectSettingsSection.value).toBe("roles");
  expect(focusedRoleId.value).toBe("role-p");
  expect(opened).toEqual([
    ["ide.workbench.project.settings.open", undefined, { scope: "editor:p1" }],
  ]);
});

test("chat.list marks a trusted project role as project", async () => {
  stubRoles({ project: [projectRole], trusted: true });
  const listed = await commands.get("ide.agent.roles.chat.list").run();
  expect(listed.roles).toEqual([
    expect.objectContaining({ id: "role-g", source: "global" }),
    expect.objectContaining({ id: "role-p", source: "project" }),
  ]);
});

test("edit rejects an unknown role", async () => {
  stubRoles();
  await expect(commands.get("ide.agent.role.edit").run({ role: "missing" })).rejects.toThrow(
    /Неизвестная chat-роль/,
  );
  expect(opened).toEqual([]);
});
