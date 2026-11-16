import { expect, test } from "vite-plus/test";
import { createBrowserFixture } from "../../../tests/fixtures/browser-server.mjs";
import { chromium, createChromium } from "../../../tests/fixtures/chromium-driver.mjs";

const projectId = "zen-fixture";
const projectPath = "/tmp/zen-fixture";
const chatHistoryTurns = [
  {
    id: "u1",
    role: "user",
    at: Date.now() - 60000,
    text: "Покажи краткий итог по проекту",
    tools: [],
  },
  {
    id: "a1",
    role: "assistant",
    at: Date.now() - 30000,
    text: "Готовый ответ для чтения в Zen.",
    usage: { input: 100, output: 40, cacheRead: 0, cacheWrite: 0, cost: 0.01 },
    tools: [
      {
        id: "call-1",
        name: "Edit",
        status: "done",
        input: JSON.stringify({
          file_path: `${projectPath}/README.md`,
          old_string: "a",
          new_string: "b\nc",
        }),
        detail: "ok",
      },
    ],
    parts: [
      { type: "thought", text: "Читаю README перед ответом." },
      { type: "tool", id: "call-1" },
      { type: "text", text: "Готовый ответ для чтения в Zen." },
    ],
  },
];

const html = `<!doctype html>
<html>
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
      import { CommandPalette, provideIdeCommands } from "/packages/client/modules/ide/index.ts";
      import AppShell from "/packages/client/app/layouts/AppShell.vue";
      import ProjectWorkspace from "/packages/client/modules/workspace/ui/ProjectWorkspace.vue";
      import { defineTab, registerWorkspaceProfile } from "/packages/client/modules/workspace-api/index.ts";
      import { sessions } from "/packages/client/modules/agent-core/model/chat-state.ts";
      import { zenMode } from "/packages/client/common/utilities/zen-mode.ts";

      registerBuiltinClientAgents();
      registerWorkspaceProfile(${JSON.stringify(projectId)}, {
        id: "zen-test",
        layout: "full",
        tabs: [
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
        name: "Zen Fixture",
        iconUrl: "/favicon.svg",
      };

      const WorkspacePage = {
        setup() {
          return () => h(ProjectWorkspace, { projectId: ${JSON.stringify(projectId)} });
        },
      };

      const router = createRouter({
        history: createMemoryHistory(),
        routes: [
          { path: "/", name: "launcher", component: { render: () => null } },
          { path: "/projects/:projectPath(.*)+", name: "project", component: WorkspacePage },
        ],
      });
      await router.push("/projects" + ${JSON.stringify(projectPath)});
      await router.isReady();

      const app = createApp({
        setup() {
          const ide = provideIdeCommands();
          window.__ide = ide;
          return () => [
            h(CommandPalette),
            h(AppShell, { currentProject }, { default: () => h(WorkspacePage) }),
          ];
        },
      });
      app.use(router);
      app.mount("#app");

      window.fixture = {
        ready: true,
        sdk: window.projector.ide,
        zenMode,
        sessions,
        openChat() {
          const editor = window.projector.ide
            .getScopes()
            .find((scope) => scope.context.surface === "editor");
          return window.projector.ide.executeCommand("ide.workbench.agent.open", undefined, {
            scope: editor.id,
          });
        },
        injectRequestsAndQueue() {
          for (const state of sessions.values()) {
            state.permissions = [
              { id: "perm-1", tool: "bash", title: "Запустить команду?", detail: "echo ok", persistent: false },
            ];
            state.queue = [
              { id: "q-1", text: "Следующий шаг в очереди", parts: [{ type: "text", text: "Следующий шаг в очереди" }] },
            ];
          }
        },
      };
    </script>
  </body>
</html>`;

test(
  "zen mode hides chrome, chat composer, footers and work blocks while keeping messages and requests",
  { skip: !chromium, timeout: 60000, retry: 1 },
  async ({ onTestFinished }) => {
    const fixture = await createBrowserFixture({
      pages: { "/__zen": html },
      responses: [
        { equals: "/api/ide/keybindings", type: "application/json", body: '{"bindings":[]}' },
        {
          equals: "/api/projects",
          type: "application/json",
          body: JSON.stringify({
            projects: [{ id: projectId, path: projectPath, name: "Zen Fixture" }],
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
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    await browser.viewport(1280, 820);
    await browser.open(fixture.url("/__zen"));

    const waitFor = async (expression, ms = 10000) => {
      const deadline = Date.now() + ms;
      while (!(await browser.evaluate(expression))) {
        if (Date.now() > deadline) {
          throw new Error(`Timed out waiting for: ${expression}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    };

    await waitFor("!!window.fixture");
    await browser.evaluate("window.fixture.openChat()");
    await waitFor("document.querySelector('.agent-chat .cm-content') !== null");
    await waitFor("document.querySelectorAll('.agent-chat .turn').length === 2");
    await browser.evaluate("window.fixture.injectRequestsAndQueue()");
    await waitFor("document.querySelector('.agent-chat .activity') !== null");
    await waitFor("document.querySelector('.agent-chat .requests') !== null");

    const shown = (selector) =>
      browser.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      })()`);

    // Normal mode: shell header, sidebars, status bar, dock header and chat chrome are visible.
    expect(await shown("header.top")).toBe(true);
    expect(await shown(".workspace > .sidebar")).toBe(true);
    expect(await shown(".workspace-status")).toBe(true);
    expect(await shown(".dock-group .dock-header")).toBe(true);
    expect(await shown(".agent-chat .chat-tools")).toBe(true);
    expect(await shown(".agent-chat .composer-area")).toBe(true);
    expect(await shown(".agent-chat .turn-actions")).toBe(true);
    expect(await shown(".agent-chat .work")).toBe(true);
    expect(await shown(".agent-chat .changes")).toBe(true);
    expect(await shown(".agent-chat .turn-footer")).toBe(true);
    expect(await shown(".agent-chat .activity")).toBe(true);
    expect(await shown(".agent-chat .requests")).toBe(true);

    const pressModShift = async (key, code, virtualKey) => {
      await browser.call("Input.dispatchKeyEvent", {
        type: "keyDown",
        key,
        code,
        windowsVirtualKeyCode: virtualKey,
        modifiers: 2 | 8,
      });
      await browser.call("Input.dispatchKeyEvent", {
        type: "keyUp",
        key,
        code,
        windowsVirtualKeyCode: virtualKey,
        modifiers: 2 | 8,
      });
    };
    const pressCtrlShiftZ = () => pressModShift("Z", "KeyZ", 90);
    const pressCtrlShiftP = () => pressModShift("P", "KeyP", 80);

    // Focus the composer input, type a draft, and press Ctrl+Shift+Z.
    await browser.click(".agent-chat .cm-content");
    await browser.call("Input.insertText", { text: "неотправленный черновик" });
    await waitFor(
      "document.querySelector('.agent-chat .cm-content').textContent.includes('неотправленный черновик')",
    );
    await pressCtrlShiftZ();
    await waitFor("window.fixture.zenMode.value === true");

    // In Zen mode: outer shell, sidebars, footer, dock tabs, composer, chat tools, turn footers,
    // work blocks, changes and activity dock are all hidden.
    expect(await shown("header.top")).toBe(false);
    expect(await shown(".workspace > .sidebar")).toBe(false);
    expect(await shown(".workspace-status")).toBe(false);
    expect(await shown(".dock-group .dock-header")).toBe(false);
    expect(await shown(".agent-chat .chat-tools")).toBe(false);
    expect(await shown(".agent-chat .composer-area")).toBe(false);
    expect(await shown(".agent-chat .turn-actions")).toBe(false);
    expect(await shown(".agent-chat .work")).toBe(false);
    expect(await shown(".agent-chat .changes")).toBe(false);
    expect(await shown(".agent-chat .turn-footer")).toBe(false);
    expect(await shown(".agent-chat .activity")).toBe(false);

    // Conversation text, interactive requests and the exit button remain visible; the panel fills the viewport.
    expect(await shown(".agent-chat .user-message")).toBe(true);
    expect(await shown(".agent-chat .agent-message")).toBe(true);
    expect(await shown(".agent-chat .requests")).toBe(true);
    expect(await shown(".workspace .zen-exit")).toBe(true);
    const panelBox = await browser.evaluate(
      "(() => { const r = document.querySelector('.dock-group.zen').getBoundingClientRect(); return { w: r.width, h: r.height, iw: innerWidth, ih: innerHeight }; })()",
    );
    expect(panelBox.w).toBeGreaterThanOrEqual(panelBox.iw - 1);
    expect(panelBox.h).toBeGreaterThanOrEqual(panelBox.ih - 1);

    // Opening CommandPalette and pressing Escape closes the palette without exiting Zen.
    await browser.call("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "F1",
      code: "F1",
      windowsVirtualKeyCode: 112,
    });
    await browser.call("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "F1",
      code: "F1",
      windowsVirtualKeyCode: 112,
    });
    await waitFor("document.querySelector('dialog.command-palette[open]') !== null");
    await browser.key("Escape");
    await waitFor("document.querySelector('dialog.command-palette[open]') === null");
    expect(await browser.evaluate("window.fixture.zenMode.value")).toBe(true);

    // Pressing Escape on the Zen view exits Zen and preserves the unsent draft.
    await browser.key("Escape");
    await waitFor("window.fixture.zenMode.value === false");
    expect(await shown("header.top")).toBe(true);
    expect(await shown(".agent-chat .composer-area")).toBe(true);
    expect(
      await browser.evaluate("document.querySelector('.agent-chat .cm-content').textContent"),
    ).toContain("неотправленный черновик");

    // Enter Zen via the chat menu item and exit via the corner button, restoring composer focus.
    await browser.click(".agent-chat .chat-menu button");
    await waitFor(
      "document.querySelector('.island [data-command=\"ide.workbench.zen.toggle\"]') !== null",
    );
    await browser.click('.island [data-command="ide.workbench.zen.toggle"]');
    await waitFor("window.fixture.zenMode.value === true");
    await browser.click(".workspace .zen-exit");
    await waitFor("window.fixture.zenMode.value === false");
    await waitFor("!!document.activeElement?.closest('.agent-chat .cm-content')");

    // Enter Zen via the layout menu ("Раскладка") and verify it on tablet width as well.
    await browser.click('button[aria-label="Раскладка"]');
    await waitFor(
      "document.querySelector('.island [data-command=\"ide.workbench.zen.toggle\"]') !== null",
    );
    expect(
      await browser.evaluate(
        "document.querySelector('.island [data-command=\"ide.workbench.zen.toggle\"] .zen-kbd')?.textContent",
      ),
    ).toBe("Ctrl+Shift+Z");
    await browser.click('.island [data-command="ide.workbench.zen.toggle"]');
    await waitFor("window.fixture.zenMode.value === true");
    await browser.viewport(850, 760);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const tabletBox = await browser.evaluate(
      "(() => { const r = document.querySelector('.dock-group.zen').getBoundingClientRect(); return { w: r.width, h: r.height, iw: innerWidth, ih: innerHeight }; })()",
    );
    expect(tabletBox.w).toBeGreaterThanOrEqual(tabletBox.iw - 1);
    expect(tabletBox.h).toBeGreaterThanOrEqual(tabletBox.ih - 1);
    await browser.click(".workspace .zen-exit");
    await waitFor("window.fixture.zenMode.value === false");

    // Narrow mobile viewport: mobile pills and tabs also hide in Zen and return on exit.
    await browser.viewport(390, 844);
    await waitFor("document.querySelector('.mobile-surfaces') !== null");
    expect(await shown(".mobile-surfaces")).toBe(true);
    await pressCtrlShiftZ();
    await waitFor("window.fixture.zenMode.value === true");
    expect(await shown(".mobile-surfaces")).toBe(false);
    expect(await shown(".mobile-dock .tabs")).toBe(false);
    expect(await shown(".workspace .zen-exit")).toBe(true);
    await browser.click(".workspace .zen-exit");
    await waitFor("window.fixture.zenMode.value === false");
    expect(await shown(".mobile-surfaces")).toBe(true);
    expect(browser.errors.filter((error) => error.exception)).toEqual([]);
  },
);
