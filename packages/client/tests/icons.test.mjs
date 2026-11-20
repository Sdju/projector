import { expect, test, vi } from "vite-plus/test";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import ProjectorIcon from "../common/icons/ProjectorIcon.vue";
import {
  ICON_FALLBACK,
  hasIcon,
  iconNames,
  registerIcon,
  resolveIcon,
  unregisterIcon,
} from "../common/icons/registry.ts";
import { deviconIcons, lucideIcons, simpleIcons } from "../common/icons/sets.ts";

function render(props, attrs = {}) {
  return renderToString(createSSRApp({ render: () => h(ProjectorIcon, { ...props, ...attrs }) }));
}

test("the bundled sets resolve by name, a bare name means Lucide", () => {
  for (const name of Object.keys(lucideIcons)) expect(hasIcon(name), name).toBe(true);
  for (const name of Object.keys(simpleIcons))
    expect(hasIcon(`simple-icons:${name}`), name).toBe(true);
  for (const name of Object.keys(deviconIcons)) expect(hasIcon(`devicon:${name}`), name).toBe(true);
  expect(hasIcon("chevron-right")).toBe(true);
  expect(hasIcon("lucide:chevron-right")).toBe(true);
  expect(hasIcon(ICON_FALLBACK)).toBe(true);
  expect(hasIcon("not-a-real-icon")).toBe(false);
  expect(hasIcon("simple-icons:not-a-real-icon")).toBe(false);
});

test("the service renders one svg, keeps the caller class and hides decorative icons", async () => {
  const markup = await render({ name: "chevron-right" }, { class: "chevron" });
  expect(markup.match(/<svg/g)).toHaveLength(1);
  expect(markup).toMatch(/<svg[^>]*class="[^"]*\bprojector-icon\b/);
  expect(markup).toMatch(/<svg[^>]*class="[^"]*\bchevron\b/);
  expect(markup).toContain('aria-hidden="true"');
  expect(markup).not.toContain("<span");
});

test("a label makes the icon an accessible image", async () => {
  const markup = await render({ name: "git-branch", label: "Ветка" });
  expect(markup).toContain('role="img"');
  expect(markup).toContain('aria-label="Ветка"');
  expect(markup).not.toContain('aria-hidden="true"');
});

test("an unknown name warns once and shows the fallback", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const first = await render({ name: "not-a-real-icon" });
  const second = await render({ name: "not-a-real-icon" });
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0]?.[0]).toContain("not-a-real-icon");
  expect(first).toBe(second);
  expect(first).toContain("<svg");
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("registerIcon"));
});

test("a non-text name from stale data falls back instead of breaking the page", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const markup = await render({ name: 42 });
  expect(markup).toContain("<svg");
  // Vue also warns about the prop type; the service still adds its own, explained warning.
  expect(
    warn.mock.calls.filter(([message]) => String(message).includes("registerIcon")),
  ).toHaveLength(1);
  warn.mockRestore();
});

test("a runtime icon replaces a bundled one and disappears again", async () => {
  const Stub = { render: () => h("svg", { "data-stub": "yes" }) };
  registerIcon("star", Stub);
  expect(resolveIcon("star")).toBe(Stub);
  expect(await render({ name: "star" })).toContain('data-stub="yes"');

  registerIcon("project:custom", Stub);
  expect(hasIcon("project:custom")).toBe(true);
  expect(iconNames()).toContain("project:custom");

  unregisterIcon("star");
  unregisterIcon("project:custom");
  expect(hasIcon("project:custom")).toBe(false);
  expect(resolveIcon("star")).not.toBe(Stub);
  expect(await render({ name: "star" })).not.toContain('data-stub="yes"');
});
