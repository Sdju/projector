import { expect, test } from "vite-plus/test";
import { createBrowserFixture } from "../../../tests/fixtures/browser-server.mjs";
import { chromium, createChromium } from "../../../tests/fixtures/chromium-driver.mjs";

const html = `<!doctype html>
<meta charset="utf-8">
<link rel="icon" href="data:,">
<div id="header-tools"></div><div id="app" style="height: 780px"></div>
<script type="module">
  import "/packages/client/app/styles.css";
  import { createApp, h } from "vue";
  import { createMemoryHistory, createRouter } from "vue-router";
  import { provideIdeCommands } from "/packages/client/modules/ide/index.ts";
  import { ProjectWorkspace } from "/packages/client/modules/workspace/index.ts";
  import { registerWorkspaceProfile, workspaceAside } from "/packages/client/modules/workspace-api/index.ts";

  const projectId = "sidebar-test";
  registerWorkspaceProfile(projectId, {
    id: "sidebar-test",
    layout: "editor",
    aside: workspaceAside,
    sidebar: [{ id: "child", group: "files", kind: "test", title: "Child" }],
    utility: [{ id: "utility", kind: "test", title: "Utility" }],
    providers: { files: {
      assetUrl: (path) => path,
      read: async (action) => action === "root"
        ? { root: "/tmp/sidebar-test" }
        : { entries: [], items: [], children: [], total: 0 },
    } },
  });
  const fetchApi = window.fetch.bind(window);
  window.fetch = (url, options) => {
    if (url !== "/api/ide/action-order") return fetchApi(url, options);
    const data = JSON.parse(sessionStorage.getItem("order-fixture") ?? "{}");
    if (options?.method === "PUT") {
      const { scope, ids } = JSON.parse(options.body);
      data[scope] = ids;
      sessionStorage.setItem("order-fixture", JSON.stringify(data));
    }
    return Promise.resolve(Response.json(data));
  };
  const sidebarViews = {
    files: {
      icon: { render: () => h("svg") },
      component: { render: () => h("input", { id: "file-view" }) },
      props: () => ({}),
    },
    test: {
      icon: { render: () => h("svg") },
      component: { render: () => h("div") },
      props: () => ({}),
    },
  };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: { render: () => null } }],
  });
  await router.push("/");
  createApp({
    setup() {
      provideIdeCommands();
      return () => h(ProjectWorkspace, { projectId, sidebarViews });
    },
  }).use(router).mount("#app");
  const sdk = window.projector.ide;
  window.fixture = {
    ready: true,
    run(id, args) {
      const editor = sdk.getScopes().find((scope) => scope.context.surface === "editor");
      return sdk.executeCommand(id, args, { scope: editor.id });
    },
  };
</script>`;

const left = ".workspace > .sidebar:not(.aside)";
const right = ".workspace > .aside";
const section = (side, name) => `${side} nav button[aria-label="${name}"]`;
const exists = (selector) => `Boolean(document.querySelector(${JSON.stringify(selector)}))`;
const waitFor = (browser, expression) =>
  expect.poll(() => browser.evaluate(expression), { timeout: 8000 }).toBe(true);

test(
  "sidebar groups move between rails without remounting and restore their saved side",
  { skip: !chromium, timeout: 45000 },
  async ({ onTestFinished }) => {
    const fixture = await createBrowserFixture({
      pages: { "/__sidebar": html },
      responses: [
        { equals: "/api/launcher/settings", type: "application/json", body: '{"rightPanel":true}' },
        { startsWith: "/api/", type: "application/json", body: "{}" },
      ],
    });
    const browser = await createChromium(fixture.directory);
    onTestFinished(async () => {
      await browser.close();
      await fixture.close();
    });
    await browser.viewport(1280, 820);
    await browser.open(fixture.url("/__sidebar"));
    const filesRight = section(right, "Файлы");
    const filesLeft = section(left, "Файлы");
    const terminals = section(right, "Терминалы");
    await waitFor(browser, exists(terminals));
    await browser.evaluate('window.originalFileView = document.querySelector("#file-view")');

    const point = (selector, y = 0.5) =>
      browser.evaluate(`(() => {
        const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height * ${y} };
      })()`);
    const mouse = (type, at, button = "left") =>
      browser.call("Input.dispatchMouseEvent", {
        type,
        ...at,
        button,
        buttons: type === "mouseReleased" ? 0 : button === "right" ? 2 : 1,
        clickCount: 1,
      });
    async function startDrag(selector) {
      const from = await point(selector);
      await mouse("mousePressed", from);
      await mouse("mouseMoved", { ...from, x: from.x + 8 });
      await waitFor(browser, exists(".side-group.dragging"));
    }

    await startDrag(filesLeft);
    const to = await point(terminals, 0.2);
    await mouse("mouseMoved", to);
    await mouse("mouseMoved", { ...to, y: to.y + 1 });
    await waitFor(browser, exists(`${right} .drop-before`));
    await mouse("mouseReleased", to);
    await waitFor(browser, exists(filesRight));
    expect(await browser.evaluate(exists(section(right, "Child")))).toBe(true);
    expect(
      await browser.evaluate(
        `document.querySelector('${right} #file-view') === window.originalFileView`,
      ),
    ).toBe(true);
    expect(await browser.evaluate(exists(filesLeft))).toBe(false);

    // Utility has no compatible neighbor on the right, so the insertion area accepts the drop.
    await startDrag(section(left, "Utility"));
    const emptyTarget = await point(`${right} .empty-drop`);
    await mouse("mouseMoved", emptyTarget);
    await mouse("mouseMoved", { ...emptyTarget, y: emptyTarget.y + 1 });
    await waitFor(browser, exists(`${right} .empty-drop.drop-before`));
    await mouse("mouseReleased", emptyTarget);
    await waitFor(browser, exists(section(right, "Utility")));

    await browser.open(fixture.url("/__sidebar"));
    await waitFor(browser, exists(filesRight));
    await browser.evaluate(
      'window.fixture.run("ide.workbench.section.show", { section: "files" })',
    );
    await waitFor(
      browser,
      `Boolean(document.querySelector('${right} #file-view')?.getBoundingClientRect().width)`,
    );
    await browser.evaluate(
      'window.fixture.run("ide.workbench.rightPanel.toggle", { enabled: false })',
    );
    await waitFor(browser, exists(filesLeft));
    await browser.evaluate(
      'window.fixture.run("ide.workbench.rightPanel.toggle", { enabled: true })',
    );
    await waitFor(browser, exists(filesRight));

    const child = await point(section(right, "Child"));
    await mouse("mousePressed", child, "right");
    await mouse("mouseReleased", child, "right");
    const moveLeft = ':popover-open [role="menuitem"][data-command="ide.workbench.section.move"]';
    await waitFor(browser, exists(moveLeft));
    expect(await browser.evaluate(`document.querySelector('${moveLeft}').textContent.trim()`)).toBe(
      "Переместить влево",
    );
    await browser.click(moveLeft);
    await waitFor(browser, exists(filesLeft));
    expect(await browser.evaluate(exists(section(left, "Child")))).toBe(true);
    expect(await browser.evaluate(exists(filesRight))).toBe(false);
    expect(browser.errors.filter((error) => "exception" in error)).toEqual([]);
  },
);
