import { expect, test } from "vite-plus/test";
import { createBrowserFixture } from "../../../tests/fixtures/browser-server.mjs";
import { chromium, createChromium } from "../../../tests/fixtures/chromium-driver.mjs";

// The phone keyboard shrinks only the visual viewport: the workspace shell must follow it,
// otherwise the composer stays under the keyboard while `100dvh` keeps the full screen.
const shellHtml = `<!doctype html>
<html lang="ru">
  <head>
    <link rel="icon" href="data:," />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin:0">
    <div id="app"></div>
    <script type="module">
      import "/packages/client/app/styles.css";
      import { createApp, h } from "vue";
      import { createMemoryHistory, createRouter } from "vue-router";
      import { provideIdeCommands } from "/packages/client/modules/ide/index.ts";
      import AppShell from "/packages/client/app/layouts/AppShell.vue";
      import { syncAppViewport } from "/packages/client/common/utilities/app-viewport.ts";

      const Page = {
        render: () => h("div", { class: "project-page", "data-surface": "agent" }, "agent"),
      };
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [
          { path: "/", name: "launcher", component: { render: () => null } },
          { path: "/projects/:projectPath(.*)+", name: "project", component: Page },
        ],
      });
      await router.push("/projects/tmp-mobile-viewport");
      await router.isReady();
      const currentProject = { id: "mobile-viewport", path: "/tmp/mobile-viewport", name: "Телефон" };
      const app = createApp({
        setup() {
          provideIdeCommands();
          return () => h(AppShell, { currentProject }, { default: () => h(Page) });
        },
      });
      app.use(router);
      app.mount("#app");

      window.fixture = {
        ready: true,
        async keyboard(height, offsetTop = 0) {
          const value = syncAppViewport(
            document.documentElement,
            { height, offsetTop },
            window.innerHeight,
          );
          await new Promise((resolve) => requestAnimationFrame(resolve));
          return value;
        },
        measure() {
          const shell = document.querySelector(".shell.workspace");
          return {
            height: Math.round(shell.getBoundingClientRect().height),
            variable: getComputedStyle(document.documentElement)
              .getPropertyValue("--app-viewport-height")
              .trim(),
            scrollHeight: document.documentElement.scrollHeight,
          };
        },
      };
    </script>
  </body>
</html>`;

const projectId = "phone-chat";
const projectPath = "/tmp/phone-chat";
const chatHistoryTurns = [
  {
    id: "u1",
    role: "user",
    at: Date.now() - 60000,
    text: "Проверь сборку",
    tools: [],
  },
  {
    id: "a1",
    role: "assistant",
    at: Date.now() - 30000,
    text: "Сборка проходит.",
    usage: { input: 100, output: 40, cacheRead: 0, cacheWrite: 0, cost: 0.01 },
    tools: [],
    parts: [{ type: "text", text: "Сборка проходит." }],
  },
];

// A real workspace with an agent chat: the composer has to stay above the keyboard.
const chatHtml = `<!doctype html>
<html lang="ru">
  <head>
    <link rel="icon" href="data:," />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin:0">
    <div id="app"></div>
    <script type="module">
      import "/packages/client/app/styles.css";
      import { createApp, h } from "vue";
      import { createMemoryHistory, createRouter } from "vue-router";
      import { registerBuiltinClientAgents } from "/packages/client/app/agents.ts";
      import { provideIdeCommands } from "/packages/client/modules/ide/index.ts";
      import AppShell from "/packages/client/app/layouts/AppShell.vue";
      import ProjectWorkspace from "/packages/client/modules/workspace/ui/ProjectWorkspace.vue";
      import { defineTab, inboxTab, registerWorkspaceProfile } from "/packages/client/modules/workspace-api/index.ts";
      import { syncAppViewport } from "/packages/client/common/utilities/app-viewport.ts";

      registerBuiltinClientAgents();
      registerWorkspaceProfile(${JSON.stringify(projectId)}, {
        id: "phone-chat-test",
        layout: "full",
        tabs: [
          inboxTab,
          defineTab({
            id: "agent",
            key: (params) => (params.chatId ? "agent:chat:" + params.chatId : "agent:chat"),
            path: (params) => params.title ?? "Агент",
            title: (params) => params.title ?? "Чат с агентом Projector",
            command: { id: "ide.workbench.agent.open", title: "Открыть чат", requires: "agent" },
          }),
        ],
        features: {
          terminals: true,
          docker: false,
          agent: true,
          settings: false,
          persist: false,
          externalFiles: false,
        },
        providers: {
          files: {
            assetUrl: (path) => path,
            read: async (action) => {
              if (action === "root") return { root: ${JSON.stringify(projectPath)} };
              return { entries: [], items: [], children: [], total: 0, truncated: false };
            },
          },
        },
      });

      const currentProject = {
        id: ${JSON.stringify(projectId)},
        path: ${JSON.stringify(projectPath)},
        name: "Чат на телефоне",
      };
      const Page = { render: () => h(ProjectWorkspace, { projectId: ${JSON.stringify(projectId)} }) };
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [
          { path: "/", name: "launcher", component: { render: () => null } },
          { path: "/projects/:projectPath(.*)+", name: "project", component: Page },
        ],
      });
      await router.push("/projects" + ${JSON.stringify(projectPath)});
      await router.isReady();

      const app = createApp({
        setup() {
          provideIdeCommands();
          return () => h(AppShell, { currentProject }, { default: () => h(Page) });
        },
      });
      app.use(router);
      app.mount("#app");

      window.fixture = {
        ready: true,
        openChat() {
          const editor = window.projector.ide
            .getScopes()
            .find((scope) => scope.context.surface === "editor");
          return window.projector.ide.executeCommand("ide.workbench.agent.open", undefined, {
            scope: editor.id,
          });
        },
        async keyboard(height, offsetTop = 0) {
          const value = syncAppViewport(
            document.documentElement,
            { height, offsetTop },
            window.innerHeight,
          );
          await new Promise((resolve) => requestAnimationFrame(resolve));
          return value;
        },
        composer() {
          const el = document.querySelector(".agent-chat .composer-area");
          if (!el) return undefined;
          const rect = el.getBoundingClientRect();
          return { top: Math.round(rect.top), bottom: Math.round(rect.bottom) };
        },
        showSurface(surface) {
          const editor = window.projector.ide
            .getScopes()
            .find((scope) => scope.context.surface === "editor");
          return window.projector.ide.executeCommand(
            "ide.workbench.mobile.surface.show",
            { surface },
            { scope: editor.id },
          );
        },
      };
    </script>
  </body>
</html>`;

const waitFor = async (browser, expression, ms = 10000) => {
  const deadline = Date.now() + ms;
  while (!(await browser.evaluate(expression))) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${expression}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
};

test(
  "the phone workspace shell follows the area above the soft keyboard",
  { skip: !chromium, timeout: 45000 },
  async () => {
    const fixture = await createBrowserFixture({ pages: { "/__mobile-viewport": shellHtml } });
    const browser = await createChromium(fixture.directory);
    try {
      await browser.viewport(390, 844);
      await browser.open(fixture.url("/__mobile-viewport"));
      expect(await browser.evaluate("window.fixture.measure()")).toStrictEqual({
        height: 844,
        variable: "",
        scrollHeight: 844,
      });
      // Browser chrome alone is not a keyboard: the shell keeps the `100dvh` height.
      expect(await browser.evaluate("window.fixture.keyboard(780)")).toBe(undefined);
      expect((await browser.evaluate("window.fixture.measure()")).height).toBe(844);
      expect(await browser.evaluate("window.fixture.keyboard(508)")).toBe(508);
      expect(await browser.evaluate("window.fixture.measure()")).toStrictEqual({
        height: 508,
        variable: "508px",
        scrollHeight: 844,
      });
      // Safari pans the visual viewport down to reveal the field: the visible bottom edge stays put.
      expect(await browser.evaluate("window.fixture.keyboard(488, 20)")).toBe(508);
      expect((await browser.evaluate("window.fixture.measure()")).height).toBe(508);
      expect(await browser.evaluate("window.fixture.keyboard(844)")).toBe(undefined);
      expect((await browser.evaluate("window.fixture.measure()")).height).toBe(844);
      // The fullscreen API hides browser chrome but not the keyboard: the shell still follows it.
      if (await browser.evaluate("document.fullscreenEnabled")) {
        const entered = await browser.call("Runtime.evaluate", {
          expression:
            "document.documentElement.requestFullscreen().then(() => document.fullscreenElement === document.documentElement)",
          awaitPromise: true,
          returnByValue: true,
          userGesture: true,
        });
        expect(entered.result.value).toBe(true);
        expect(await browser.evaluate("window.fixture.keyboard(508)")).toBe(508);
        expect((await browser.evaluate("window.fixture.measure()")).height).toBe(508);
        await browser.evaluate("document.exitFullscreen()");
        expect(await browser.evaluate("window.fixture.keyboard(844)")).toBe(undefined);
        expect((await browser.evaluate("window.fixture.measure()")).height).toBe(844);
      }
    } finally {
      await browser.close();
      await fixture.close();
    }
  },
);

test(
  "the chat composer rises above the phone keyboard",
  { skip: !chromium, timeout: 60000, retry: 1 },
  async () => {
    const fixture = await createBrowserFixture({
      pages: { "/__mobile-chat": chatHtml },
      responses: [
        { equals: "/api/ide/keybindings", type: "application/json", body: '{"bindings":[]}' },
        {
          equals: "/api/projects",
          type: "application/json",
          body: JSON.stringify({
            projects: [{ id: projectId, path: projectPath, name: "Чат на телефоне" }],
          }),
        },
        {
          equals: "/api/health",
          type: "application/json",
          body: JSON.stringify({ ok: true, app: "projector", pid: 1, mode: "dev" }),
        },
        {
          equals: "/api/agent/features",
          type: "application/json",
          body: JSON.stringify({ features: [] }),
        },
        {
          startsWith: "/api/agent/defaults",
          type: "application/json",
          body: JSON.stringify({ defaults: {} }),
        },
        {
          startsWith: "/api/agent/history/",
          type: "application/json",
          body: JSON.stringify({ turns: chatHistoryTurns, features: null }),
        },
        {
          startsWith: "/api/agent/controls",
          type: "application/json",
          body: JSON.stringify({ controls: [], capabilities: {} }),
        },
        {
          startsWith: "/api/agent/commands",
          type: "application/json",
          body: JSON.stringify({ commands: [] }),
        },
        {
          startsWith: "/api/agent/presets",
          type: "application/json",
          body: JSON.stringify({ presets: [] }),
        },
        {
          startsWith: "/api/agent/jobs",
          type: "application/json",
          body: JSON.stringify({ jobs: [] }),
        },
        {
          startsWith: "/api/projects/",
          type: "application/json",
          body: JSON.stringify({ sessions: [] }),
        },
        { startsWith: "/api/", type: "application/json", body: "{}" },
      ],
    });
    const browser = await createChromium(fixture.directory);
    try {
      await browser.viewport(390, 844);
      await browser.open(fixture.url("/__mobile-chat"));
      await browser.evaluate("window.fixture.openChat()");
      await waitFor(browser, "document.querySelector('.agent-chat .cm-content') !== null");
      await waitFor(browser, "document.querySelector('.agent-chat .composer-area') !== null");

      const open = await browser.evaluate("window.fixture.composer()");
      expect(open.bottom).toBeLessThanOrEqual(844);
      expect(open.bottom).toBeGreaterThan(760);

      expect(await browser.evaluate("window.fixture.keyboard(508)")).toBe(508);
      const covered = await browser.evaluate("window.fixture.composer()");
      expect(covered.bottom).toBeLessThanOrEqual(508);
      expect(covered.bottom).toBeGreaterThan(440);
      expect(covered.top).toBeLessThan(covered.bottom);

      // The bell opens the works as a dock tab: no overlay above the workspace, the tab closes itself.
      await browser.evaluate("window.fixture.keyboard(844)");
      await browser.evaluate("window.fixture.showSurface('terminal')");
      await waitFor(browser, "!!document.querySelector('.surface.terminal .bell')");
      await browser.evaluate("document.querySelector('.surface.terminal .bell').click()");
      await waitFor(
        browser,
        "document.querySelector('.workspace-tabs .tab-close') && !!document.querySelector('.inbox')",
      );
      expect(await browser.evaluate("document.querySelectorAll('dialog[open]').length")).toBe(0);
      expect(
        await browser.evaluate(
          "document.querySelector('.workspace-tabs .workspace-tab.selected .tab-label').textContent.trim()",
        ),
      ).toBe("Работы");
      await browser.evaluate("document.querySelector('.workspace-tabs .tab-close').click()");
      await waitFor(browser, "!document.querySelector('.inbox')");
    } finally {
      await browser.close();
      await fixture.close();
    }
  },
);
