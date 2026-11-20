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
    sidebar: [
      { id: "child", group: "files", kind: "test", title: "Child" },
      { id: "hidden-test", kind: "test", title: "Hidden" },
      { id: "anchor-test", kind: "test", title: "Anchor" },
      { id: "last-test", kind: "test", title: "Last" },
    ],
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
    if (url === "/api/ide/hidden-actions") {
      let hidden = JSON.parse(sessionStorage.getItem("hidden-fixture") ?? "[]");
      if (options?.method === "PUT") {
        const { id, hidden: hide } = JSON.parse(options.body);
        hidden = hide ? [...new Set([...hidden, id])] : hidden.filter((key) => key !== id);
        sessionStorage.setItem("hidden-fixture", JSON.stringify(hidden));
      }
      return Promise.resolve(Response.json({ hidden }));
    }
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
      icon: "files",
      component: { render: () => h("input", { id: "file-view" }) },
      props: () => ({}),
    },
    test: {
      icon: "folder-tree",
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
  "sidebar groups keep their side and both panels preserve hidden positions across reordering",
  { skip: !chromium, timeout: 60000, retry: 1 },
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

    const point = (selector, y = 0.5, x = 0.5) =>
      browser.evaluate(`(() => {
        const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return { x: r.x + r.width * ${x}, y: r.y + r.height * ${y} };
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
    await browser.evaluate(`(() => {
      sessionStorage.setItem("order-fixture", JSON.stringify({
        toolbar: ["media", "analytics", "settings", "layout"],
        "sidebar-layout:sidebar-test": ["left:files", "left:hidden-test", "left:anchor-test", "left:last-test"],
      }));
      sessionStorage.setItem("hidden-fixture", JSON.stringify(["toolbar:analytics", "sidebar:hidden-test"]));
    })()`);
    await browser.open(fixture.url("/__sidebar"));
    const media = '.sortable-action button[aria-label="Генерация медиа"]';
    const settings = '.sortable-action button[aria-label="Настройки Projector"]';
    const analytics = '.sortable-action button[aria-label="Аналитика расхода"]';
    const hidden = section(left, "Hidden");
    const anchor = section(left, "Anchor");
    const last = section(left, "Last");
    await waitFor(
      browser,
      `${exists(last)} && ${exists(settings)} && !${exists(hidden)} && !${exists(analytics)}`,
    );

    await startDrag(last);
    const sidebarInsert = await point(anchor, 0.2);
    await mouse("mouseMoved", sidebarInsert);
    await mouse("mouseMoved", { ...sidebarInsert, y: sidebarInsert.y + 1 });
    await waitFor(browser, exists(`${left} .side-group.drop-before`));
    await mouse("mouseReleased", sidebarInsert);
    await waitFor(
      browser,
      'JSON.parse(sessionStorage.getItem("order-fixture"))["sidebar-layout:sidebar-test"][2] === "left:last-test"',
    );

    const from = await point(settings);
    await mouse("mousePressed", from);
    await mouse("mouseMoved", { ...from, y: from.y + 8 });
    await waitFor(browser, exists(".sortable-action.dragging"));
    const toolbarInsert = await point(media, 0.2, 0.2);
    await mouse("mouseMoved", toolbarInsert);
    await expect
      .poll(
        async () => {
          await mouse("mouseMoved", toolbarInsert);
          return browser.evaluate(exists(".sortable-action.drop-before"));
        },
        { timeout: 8000 },
      )
      .toBe(true);
    await mouse("mouseReleased", toolbarInsert);
    await waitFor(
      browser,
      'JSON.parse(sessionStorage.getItem("order-fixture")).toolbar[0] === "settings"',
    );

    await browser.open(fixture.url("/__sidebar"));
    await waitFor(
      browser,
      `${exists(last)} && ${exists(settings)} && !${exists(hidden)} && !${exists(analytics)}`,
    );
    await browser.click('[data-command="ide.workbench.actions.hidden.toggle"]');
    await browser.click('[aria-label="Вернуть «Аналитика расхода»"]');
    await waitFor(browser, exists(analytics));
    await browser.click(`${left} [data-command="ide.workbench.section.hidden.toggle"]`);
    await browser.click('[aria-label="Вернуть «Hidden»"]');
    await waitFor(browser, exists(hidden));
    const precedes = (first, second) =>
      `Boolean(document.querySelector(${JSON.stringify(first)}).compareDocumentPosition(document.querySelector(${JSON.stringify(second)})) & Node.DOCUMENT_POSITION_FOLLOWING)`;
    expect(
      await browser.evaluate(`${precedes(settings, analytics)} && ${precedes(analytics, media)}`),
    ).toBe(true);
    expect(await browser.evaluate(`${precedes(hidden, last)} && ${precedes(last, anchor)}`)).toBe(
      true,
    );
    expect(browser.errors.filter((error) => "exception" in error)).toEqual([]);
  },
);
