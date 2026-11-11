import "../../../tests/helpers/builtins.mjs";
import { expect, test } from "vite-plus/test";
import {
  agentCatalogRevision,
  listAgentBackends,
  registerAgentBackend,
  resolveAgentBackend,
  unregisterAgentBackend,
} from "../modules/agent/registry.ts";
import { projectorBackend } from "../modules/agents/projector/index.ts";

const fake = (id, label = "Registry probe") => ({
  id,
  label,
  run: async () => {},
});

test("a backend is registered, replaced and removed, bumping the catalog revision", () => {
  const id = "registry-lifecycle-probe";
  const start = agentCatalogRevision();
  let beforeRemoval;
  try {
    registerAgentBackend(fake(id));
    const registered = agentCatalogRevision();
    expect(registered).toBeGreaterThan(start);
    expect(resolveAgentBackend(id)).toBe(id);
    expect(listAgentBackends().find((backend) => backend.id === id)?.label).toBe("Registry probe");

    // Registering the same id again replaces the backend and is a catalog change too.
    registerAgentBackend(fake(id, "Registry probe 2"));
    expect(agentCatalogRevision()).toBeGreaterThan(registered);
    expect(listAgentBackends().find((backend) => backend.id === id)?.label).toBe(
      "Registry probe 2",
    );
    beforeRemoval = agentCatalogRevision();
  } finally {
    unregisterAgentBackend(id);
  }

  expect(agentCatalogRevision()).toBeGreaterThan(beforeRemoval);
  expect(listAgentBackends().some((backend) => backend.id === id)).toBe(false);
  // A chat that still names the removed agent must fail, not fall back to another one.
  expect(() => resolveAgentBackend(id)).toThrow(`Неизвестный агент: ${id}`);
});

test("removing an unknown agent throws", () => {
  expect(() => unregisterAgentBackend("registry-never-registered")).toThrow(
    "Неизвестный агент: registry-never-registered",
  );
});

test("the default and built-in agents cannot be removed", () => {
  const defaultId = resolveAgentBackend(undefined);
  const builtinId = listAgentBackends().find((backend) => backend.builtin)?.id;
  expect(builtinId).toBeTruthy();
  expect(() => unregisterAgentBackend(defaultId)).toThrow(/нельзя удалить/);

  // Move the default aside so the built-in guard itself answers for the built-in backend.
  const probe = "registry-builtin-guard-probe";
  try {
    registerAgentBackend(fake(probe), { asDefault: true });
    expect(() => unregisterAgentBackend(builtinId)).toThrow(
      `Встроенного агента нельзя удалить: ${builtinId}`,
    );
    expect(listAgentBackends().some((backend) => backend.id === builtinId)).toBe(true);
  } finally {
    registerAgentBackend(projectorBackend, { asDefault: true });
    unregisterAgentBackend(probe);
  }
});

test("a backend that became the default cannot be removed", () => {
  const id = "registry-default-probe";
  try {
    registerAgentBackend(fake(id), { asDefault: true });
    expect(resolveAgentBackend(undefined)).toBe(id);
    expect(() => unregisterAgentBackend(id)).toThrow(/Агент по умолчанию нельзя удалить/);
    expect(listAgentBackends().some((backend) => backend.id === id)).toBe(true);
  } finally {
    // Put the real default back before removing the probe; the default must not stay missing.
    registerAgentBackend(projectorBackend, { asDefault: true });
    unregisterAgentBackend(id);
  }
  expect(resolveAgentBackend(undefined)).toBe(projectorBackend.id);
});

test("an absent or empty agent name resolves to the default", () => {
  const defaultId = resolveAgentBackend(undefined);
  expect(resolveAgentBackend(null)).toBe(defaultId);
  expect(resolveAgentBackend("")).toBe(defaultId);
});

test("a named unknown agent throws instead of returning the default", () => {
  expect(() => resolveAgentBackend("registry-missing-plugin-agent")).toThrow(
    "Неизвестный агент: registry-missing-plugin-agent",
  );
});

test("a non-string agent name throws a clear error", () => {
  for (const value of [42, true, {}, []])
    expect(() => resolveAgentBackend(value)).toThrow(/Идентификатор агента должен быть строкой/);
});
