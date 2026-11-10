import { expect, test } from "vite-plus/test";
import { effectScope, ref } from "vue";
import { createSidebarRegistry } from "../packages/client/modules/workspace-api/sidebar.ts";
import { useWorkspaceAside } from "../packages/client/modules/workspace/lib/aside-panels.ts";

function setup({ mobile = false, sections = [{ id: "hub", title: "Hub" }] } = {}) {
  const commands = new Map();
  const registry = createSidebarRegistry(() => true, sections);
  const mobileRef = ref(mobile);
  const scope = effectScope();
  let refreshes = 0;
  const state = scope.run(() =>
    useWorkspaceAside({
      registry,
      mobile: mobileRef,
      register: (id, title, run, enabled) => commands.set(id, { id, title, run, enabled }),
      refresh: () => ++refreshes,
    }),
  );
  return { state, commands, mobileRef, refreshes: () => refreshes, scope };
}

test("right rail starts collapsed and toggles its panel", () => {
  const f = setup();
  try {
    expect(f.state.visible.value).toBe(true);
    expect(f.state.hidden.value).toBe(true);
    expect(f.state.section.value).toBe("hub");
    const toggle = f.commands.get("ide.workbench.aside.toggle");
    expect(toggle.enabled()).toBe(true);
    toggle.run();
    expect(f.state.hidden.value).toBe(false);
    toggle.run();
    expect(f.state.hidden.value).toBe(true);
  } finally {
    f.scope.stop();
  }
});

test("sections open by id and close only while selected", () => {
  const f = setup({
    sections: [
      { id: "hub", title: "Hub" },
      { id: "devices", title: "Устройства" },
    ],
  });
  try {
    const show = f.commands.get("ide.workbench.aside.section.show");
    const close = f.commands.get("ide.workbench.aside.section.close");
    show.run({ section: "devices" });
    expect(f.state.section.value).toBe("devices");
    expect(f.state.hidden.value).toBe(false);
    expect(() => show.run({ section: "missing" })).toThrow("section");
    close.run({ section: "hub" });
    expect(f.state.hidden.value).toBe(false);
    close.run({ section: "devices" });
    expect(f.state.hidden.value).toBe(true);
  } finally {
    f.scope.stop();
  }
});

test("refresh works only for an open panel; narrow screens have no rail", () => {
  const f = setup();
  try {
    const refresh = f.commands.get("ide.workbench.aside.refresh");
    expect(refresh.enabled()).toBe(false);
    f.commands.get("ide.workbench.aside.toggle").run();
    expect(refresh.enabled()).toBe(true);
    refresh.run();
    expect(f.refreshes()).toBe(1);
    f.mobileRef.value = true;
    expect(f.state.visible.value).toBe(false);
    expect(f.commands.get("ide.workbench.aside.toggle").enabled()).toBe(false);
    expect(refresh.enabled()).toBe(false);
  } finally {
    f.scope.stop();
  }
});
