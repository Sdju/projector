import { expect, test } from "vite-plus/test";
import { effectScope, ref } from "vue";
import { createSidebarRegistry } from "../modules/workspace-api/sidebar.ts";
import { useWorkspaceAside } from "../modules/workspace/lib/aside-panels.ts";

function setup({
  mobile = false,
  enabled = true,
  sections = [{ id: "terminals", title: "Терминалы" }],
} = {}) {
  const commands = new Map();
  const registry = createSidebarRegistry(() => true, sections);
  const mobileRef = ref(mobile);
  const enabledRef = ref(enabled);
  const scope = effectScope();
  let refreshes = 0;
  const state = scope.run(() =>
    useWorkspaceAside({
      registry,
      mobile: mobileRef,
      enabled: () => enabledRef.value,
      register: (id, title, run, isEnabled) =>
        commands.set(id, { id, title, run, enabled: isEnabled }),
      refresh: () => ++refreshes,
    }),
  );
  return {
    state,
    commands,
    mobileRef,
    enabledRef,
    refreshes: () => refreshes,
    scope,
  };
}

test("the right rail is a setting: it toggles its panel and follows the project override", () => {
  const f = setup();
  try {
    expect(f.state.visible.value).toBe(true);
    expect(f.state.hidden.value).toBe(false);
    expect(f.state.section.value).toBe("terminals");
    const toggle = f.commands.get("ide.workbench.aside.toggle");
    expect(toggle.enabled()).toBe(true);
    toggle.run();
    expect(f.state.hidden.value).toBe(true);
    toggle.run();
    expect(f.state.hidden.value).toBe(false);
    f.enabledRef.value = false;
    expect(f.state.visible.value).toBe(false);
    expect(toggle.enabled()).toBe(false);
  } finally {
    f.scope.stop();
  }
});

test("sections open by id and close only while selected", () => {
  const f = setup({
    sections: [
      { id: "terminals", title: "Терминалы" },
      { id: "extra", title: "Ещё" },
    ],
  });
  try {
    const show = f.commands.get("ide.workbench.aside.section.show");
    const close = f.commands.get("ide.workbench.aside.section.close");
    show.run({ section: "extra" });
    expect(f.state.section.value).toBe("extra");
    expect(f.state.hidden.value).toBe(false);
    expect(() => show.run({ section: "missing" })).toThrow("section");
    close.run({ section: "terminals" });
    expect(f.state.hidden.value).toBe(false);
    close.run({ section: "extra" });
    expect(f.state.hidden.value).toBe(true);
  } finally {
    f.scope.stop();
  }
});

test("refresh works only for an open panel; narrow screens keep terminals in the dock", () => {
  const f = setup();
  try {
    const refresh = f.commands.get("ide.workbench.aside.refresh");
    expect(refresh.enabled()).toBe(true);
    refresh.run();
    expect(f.refreshes()).toBe(1);
    f.commands.get("ide.workbench.aside.toggle").run();
    expect(refresh.enabled()).toBe(false);
    f.mobileRef.value = true;
    expect(f.state.visible.value).toBe(false);
    expect(f.commands.get("ide.workbench.aside.toggle").enabled()).toBe(false);
  } finally {
    f.scope.stop();
  }
});
