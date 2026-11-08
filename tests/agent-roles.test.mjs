import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  BUILTIN_SERVICE_ROLES,
  normalizeAgentRole,
  normalizeRoleSelection,
  resolveRoleSelection,
  serviceRoleInheritsModel,
  SERVICE_ROLE_IDS,
} from "../packages/core/modules/agent-role/index.ts";
import {
  createChatRole,
  deleteChatRole,
  readAgentRole,
  resetServiceRole,
  roleSettings,
  rolesFile,
  saveChatRole,
  saveServiceRole,
  serviceRoleSelection,
} from "../packages/server/modules/agent-roles/index.ts";
import { readChatRole } from "../packages/server/modules/agent/role-store.ts";
import { writeAgentHistory } from "../packages/server/modules/agent/history.ts";
import { closeHistoryStore } from "../packages/server/modules/agent/history-store.ts";
import { readRecentChats } from "../packages/server/modules/agent/recent-chats.ts";
import { createState } from "../packages/client/modules/agent/model/chat-state.ts";
import { applyRoleSnapshot } from "../packages/client/modules/agent/model/role-apply.ts";
import { roleFromParam, roleParam } from "../packages/client/modules/agent/lib/chat-tab.ts";

let directory;
let previous;

beforeEach(async () => {
  previous = process.env.XDG_DATA_HOME;
  directory = await mkdtemp(join(tmpdir(), "projector-roles-"));
  process.env.XDG_DATA_HOME = directory;
});

afterEach(async () => {
  closeHistoryStore();
  if (previous === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previous;
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const roleOf = (settings, id) => settings.roles.find((role) => role.id === id);

describe("agent roles", () => {
  it("starts with the three service roles inheriting the chat's model", async () => {
    const settings = await roleSettings();
    expect(settings.roles.map((role) => role.id)).toEqual([...SERVICE_ROLE_IDS]);
    expect(settings.roles.map((role) => role.name)).toEqual(["Доктор", "Lens", "Судья"]);
    expect(
      settings.roles.every(
        (role) =>
          role.kind === "service" &&
          role.agent === "projector" &&
          role.builtin === true &&
          role.inherited === true &&
          Object.keys(role.selection).length === 0,
      ),
    ).toBe(true);
    expect(settings.file).toBe(rolesFile());
    expect(BUILTIN_SERVICE_ROLES).toHaveLength(3);
  });

  it("stores one role's model and returns it to the chat when cleared", async () => {
    const saved = await saveServiceRole("lens", { provider: "test:lens-model" });
    expect(roleOf(saved, "lens")).toMatchObject({
      selection: { provider: "test:lens-model" },
      inherited: false,
    });
    expect(roleOf(saved, "doctor").inherited).toBe(true);
    const stored = JSON.parse(await readFile(rolesFile(), "utf8"));
    expect(stored.builtins.lens.selection.provider).toBe("test:lens-model");

    const cleared = await saveServiceRole("lens", { provider: "" });
    expect(roleOf(cleared, "lens").inherited).toBe(true);
    const after = JSON.parse(await readFile(rolesFile(), "utf8"));
    expect(after.builtins.lens).toBeUndefined();
  });

  it("resets a role to the chat's model", async () => {
    await saveServiceRole("judge", { provider: "test:judge-model" });
    const reset = await resetServiceRole("judge");
    expect(roleOf(reset, "judge").inherited).toBe(true);
    expect(roleOf(reset, "judge").selection).toEqual({});
  });

  it("writes two roles without losing either change", async () => {
    await Promise.all([
      saveServiceRole("doctor", { provider: "test:doctor-model" }),
      saveServiceRole("lens", { provider: "test:lens-model" }),
    ]);
    const settings = await roleSettings();
    expect(roleOf(settings, "doctor").selection.provider).toBe("test:doctor-model");
    expect(roleOf(settings, "lens").selection.provider).toBe("test:lens-model");
  });

  it("rejects unknown roles and survives a broken file", async () => {
    await expect(saveServiceRole("reviewer", { provider: "x" })).rejects.toThrow("Неизвестная");
    await expect(resetServiceRole("reviewer")).rejects.toThrow("Неизвестная");

    await mkdir(join(directory, "projector", "agent"), { recursive: true });
    await writeFile(rolesFile(), "{ broken", "utf8");
    const settings = await roleSettings();
    expect(settings.roles.every((role) => role.kind === "service" && role.inherited)).toBe(true);
  });

  it("creates, updates and deletes a chat role", async () => {
    const created = await createChatRole({
      name: "Ревьюер",
      description: "Проверяет изменения",
      agent: "claude-code",
      selection: { model: "claude" },
    });
    const role = created.created;
    expect(role).toMatchObject({
      kind: "chat",
      name: "Ревьюер",
      agent: "claude-code",
      selection: { model: "claude" },
      inherited: false,
    });
    expect(role.id).toMatch(/^role-[0-9a-f]{8}$/);
    expect((await roleSettings()).roles.map((item) => item.id)).toContain(role.id);

    const saved = await saveChatRole(role.id, {
      name: "Старший ревьюер",
      description: "Проверяет особенно внимательно",
      agent: "claude-code",
      selection: { model: "claude-opus" },
    });
    expect(saved.roles.find((item) => item.id === role.id)).toMatchObject({
      name: "Старший ревьюер",
      selection: { model: "claude-opus" },
    });
    expect(await readAgentRole(role.id)).toMatchObject({ name: "Старший ревьюер" });

    const removed = await deleteChatRole(role.id);
    expect(removed.roles.some((item) => item.id === role.id)).toBe(false);
    expect(await readAgentRole(role.id)).toBeUndefined();
  });

  it("does not let chat-role changes touch the service roles", async () => {
    await expect(
      saveChatRole("doctor", { name: "Доктор", agent: "projector", selection: {} }),
    ).rejects.toThrow("Служебная");
    await expect(deleteChatRole("doctor")).rejects.toThrow("нельзя удалить");
  });

  it("keeps a chat role snapshot with the chat history", async () => {
    const snapshot = {
      roleId: "role-a1b2c3d4",
      name: "Ревьюер",
      selection: { model: "claude" },
      permissionMode: "default",
    };
    await writeAgentHistory("chat-role", [], undefined, undefined, undefined, snapshot);
    expect(readChatRole("chat-role")).toEqual(snapshot);
    // A write without the field keeps the snapshot; null removes it.
    await writeAgentHistory("chat-role", []);
    expect(readChatRole("chat-role")).toEqual(snapshot);
    await writeAgentHistory("chat-role", [], undefined, undefined, undefined, null);
    expect(readChatRole("chat-role")).toBeUndefined();
  });

  it("returns the snapshot in the project's recent chats", async () => {
    const snapshot = {
      roleId: "role-a1b2c3d4",
      name: "Ревьюер",
      selection: { provider: "test:model" },
    };
    await writeAgentHistory(
      "projector:p:role-chat",
      [{ id: "u1", role: "user", text: "Привет", tools: [] }],
      { project: "p", backend: "projector" },
      undefined,
      undefined,
      snapshot,
    );
    expect(readRecentChats("p")[0]).toMatchObject({
      chat: "projector:p:role-chat",
      role: snapshot,
    });
  });

  it("applies a role snapshot once, unless history forces another", () => {
    const state = createState();
    const first = {
      roleId: "role-a1b2c3d4",
      name: "Ревьюер",
      selection: { model: "claude" },
      permissionMode: "auto",
    };
    applyRoleSnapshot(state, first);
    expect(state.roleSnapshot).toEqual(first);
    expect(state.selection).toEqual({ model: "claude", "permission-mode": "auto" });
    expect(state.permissionMode).toBe("auto");

    applyRoleSnapshot(state, {
      roleId: "role-b1b2c3d4",
      name: "Другой",
      selection: { model: "other" },
    });
    expect(state.roleSnapshot).toEqual(first);

    applyRoleSnapshot(
      state,
      { roleId: "role-b1b2c3d4", name: "Другой", selection: { model: "other" } },
      true,
    );
    expect(state.roleSnapshot).toMatchObject({ name: "Другой", selection: { model: "other" } });
  });

  it("round-trips a role snapshot through a tab parameter", () => {
    const snapshot = {
      roleId: "role-a1b2c3d4",
      name: "Ревьюер",
      selection: { model: "claude" },
      permissionMode: "default",
    };
    expect(roleFromParam(roleParam(snapshot))).toEqual(snapshot);
    expect(roleFromParam("not json")).toBeUndefined();
    expect(roleFromParam({ ...snapshot })).toBeUndefined();
  });

  it("keeps only usable selection values", () => {
    expect(
      normalizeRoleSelection({
        provider: " test:model ",
        empty: " ",
        wrong: 1,
        ["x".repeat(101)]: "value",
        long: "x".repeat(301),
      }),
    ).toEqual({ provider: "test:model" });
  });

  it("merges the role over the chat's fallback", async () => {
    await saveServiceRole("judge", { provider: "test:judge-model" });
    expect(
      await serviceRoleSelection("judge", { provider: "test:chat-model", thinking: "low" }),
    ).toEqual({ provider: "test:judge-model", thinking: "low" });
    expect(resolveRoleSelection({ selection: {} }, { provider: "chat" })).toEqual({
      provider: "chat",
    });
    expect(serviceRoleInheritsModel({ selection: {} })).toBe(true);
    expect(serviceRoleInheritsModel({ selection: { provider: "test:model" } })).toBe(false);
  });

  it("validates a role contract for later chat roles", () => {
    expect(
      normalizeAgentRole({
        id: "reviewer",
        name: "Ревьюер",
        kind: "chat",
        agent: "claude-code",
        selection: { model: "claude" },
        permissionMode: "default",
      }),
    ).toMatchObject({
      id: "reviewer",
      name: "Ревьюер",
      kind: "chat",
      agent: "claude-code",
      selection: { model: "claude" },
      permissionMode: "default",
    });
    expect(
      normalizeAgentRole({
        id: "reviewer",
        name: "Ревьюер",
        kind: "chat",
        agent: "claude-code",
        builtin: true,
      })?.builtin,
    ).toBeUndefined();
    expect(
      normalizeAgentRole({
        id: "doctor",
        name: "Доктор",
        kind: "service",
        agent: "claude-code",
      }),
    ).toBeUndefined();
    expect(
      normalizeAgentRole({ id: "Bad id", name: "Плохо", kind: "chat", agent: "projector" }),
    ).toBeUndefined();
  });
});
