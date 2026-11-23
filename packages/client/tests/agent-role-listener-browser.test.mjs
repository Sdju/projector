import { expect, test } from "vite-plus/test";
import { createBrowserFixture } from "../../../tests/fixtures/browser-server.mjs";
import { chromium, createChromium } from "../../../tests/fixtures/chromium-driver.mjs";

const models = [
  {
    id: "gpt-image-1",
    alias: "gpt-image-1",
    capability: "image.generate",
    providerId: "openai",
    providerName: "OpenAI",
    adapter: "custom",
  },
  {
    id: "whisper-1",
    alias: "whisper-1",
    title: "Whisper 1",
    capability: "speech.transcribe",
    providerId: "openai",
    providerName: "OpenAI",
    adapter: "custom",
    description: "Распознавание речи и перевод на английский.",
    input: ["audio"],
    output: ["text"],
    prices: [{ amount: 0.006, currency: "USD", unit: "minute" }],
    priceSource: "https://example.com/pricing",
    priceCheckedAt: "2026-11-23",
  },
  {
    id: "gpt-4o-mini-transcribe",
    alias: "gpt-4o-mini-transcribe",
    capability: "speech.transcribe",
    providerId: "openai",
    providerName: "OpenAI",
    adapter: "custom",
  },
];

const html = `<!doctype html>
<link rel="icon" href="data:," />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<div id="fixture"></div>
<script type="module">
  import "/packages/client/app/styles.css";
  import { createApp, h, provide, ref } from "vue";
  import { commandHostKey } from "/packages/client/common/utilities/commands.ts";
  import AgentRoleSettings from "/packages/client/modules/agent-roles/ui/AgentRoleSettings.vue";

  const fixture = { saved: [], listen: [], commands: {} };
  const roles = [
    { id: "doctor", name: "Доктор", kind: "service", agent: "projector", selection: {}, inherited: true, builtin: true },
    { id: "lens", name: "Lens", kind: "service", agent: "projector", selection: {}, inherited: true, builtin: true },
    { id: "judge", name: "Судья", kind: "service", agent: "projector", selection: {}, inherited: true, builtin: true },
    {
      id: "listener",
      name: "Listener",
      kind: "service",
      agent: "projector",
      selection: {},
      media: { capability: "speech.transcribe" },
      inherited: true,
      builtin: true,
    },
  ];
  const models = ${JSON.stringify(models)};
  let current = roles.map((item) => ({ ...item }));

  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.startsWith("/api/agent/roles") && (init.method ?? "GET") === "GET")
      return { ok: true, json: async () => ({ roles: current, file: "/tmp/roles.json" }) };
    if (href.startsWith("/api/media/models"))
      return { ok: true, json: async () => ({ models }) };
    if (href === "/api/agent/listener") {
      fixture.listen.push(href);
      return {
        ok: true,
        json: async () => ({
          configured: true,
          providerId: "openai",
          providerName: "OpenAI",
          model: "whisper-1",
          capability: "speech.transcribe",
          auto: true,
          context: "",
        }),
      };
    }
    if (href.startsWith("/api/agent/roles/listener") && init.method === "PUT") {
      const body = JSON.parse(init.body);
      fixture.saved.push(body);
      current = current.map((item) =>
        item.id === "listener"
          ? {
              ...item,
              selection: body.selection ?? {},
              prompt: body.prompt,
              inherited: false,
            }
          : item,
      );
      return { ok: true, json: async () => ({ roles: current, file: "/tmp/roles.json" }) };
    }
    if (href === "/api/agent/roles/listener/reset" && init.method === "POST") {
      current = current.map((item) =>
        item.id === "listener" ? { ...item, selection: {}, prompt: undefined, inherited: true } : item,
      );
      return { ok: true, json: async () => ({ roles: current, file: "/tmp/roles.json" }) };
    }
    return { ok: false, json: async () => ({ error: "нет маршрута: " + href }) };
  };

  const scope = {
    id: "roles",
    activate() {},
    registerCommand(command) {
      fixture.commands[command.id] = command;
      return () => {};
    },
    describe() {},
    executeCommand: async () => {},
    resolveKeybinding() {},
    dispose() {},
  };
  const host = {
    revision: ref(0),
    createScope: () => scope,
    reportError() {},
  };
  const app = createApp({
    setup() {
      provide(commandHostKey, host);
      return () => h(AgentRoleSettings);
    },
  });
  app.mount("#fixture");
  fixture.ready = true;
  window.fixture = fixture;
</script>`;

test.concurrent(
  "the Listener card offers only recognition models and saves its context",
  { skip: !chromium, timeout: 90000, retry: 1 },
  async ({ onTestFinished }) => {
    const fixture = await createBrowserFixture({ pages: { "/roles": html } });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    await browser.open(fixture.url("/roles"));
    await browser.viewport(900, 1400);
    const wait = async (expression, ms = 8000) => {
      for (let waited = 0; waited < ms; waited += 50) {
        if (await browser.evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(await browser.evaluate(expression)).toBeTruthy();
    };

    await wait('document.querySelectorAll(".role").length === 4');
    // The card exists and its select holds only speech.transcribe models from the catalog.
    expect(
      await browser.evaluate(
        '[...document.querySelectorAll(".role")].find((card) => card.textContent.includes("Listener")).querySelectorAll("optgroup option").length',
      ),
    ).toBe(2);
    expect(
      await browser.evaluate(
        '[...document.querySelectorAll(".role select")].some((select) => [...select.options].some((option) => option.value === "openai:gpt-image-1"))',
      ),
    ).toBe(false);
    expect(
      await browser.evaluate(
        '[...document.querySelectorAll(".role")].find((card) => card.textContent.includes("Listener")).querySelector("textarea") !== null',
      ),
    ).toBe(true);
    expect(await browser.evaluate('document.body.textContent.includes("Whisper 1 — OpenAI")')).toBe(
      true,
    );
    // The card shows the model passport: what it is and what it costs.
    expect(
      await browser.evaluate(
        'document.body.textContent.includes("Распознавание речи и перевод на английский.")',
      ),
    ).toBe(true);
    expect(await browser.evaluate('document.body.textContent.includes("$0,006 / минута")')).toBe(
      true,
    );

    await browser.evaluate(`(() => {
      const card = [...document.querySelectorAll(".role")].find((item) => item.textContent.includes("Listener"));
      const select = card.querySelector("select");
      select.value = "openai:whisper-1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      const area = card.querySelector("textarea");
      area.value = "Projector, TypeScript";
      area.dispatchEvent(new Event("input", { bubbles: true }));
      [...card.querySelectorAll("button")].find((button) => button.textContent.includes("Сохранить")).click();
    })()`);
    await wait("window.fixture.saved.length === 1");
    expect(await browser.evaluate("window.fixture.saved[0]")).toEqual({
      selection: { provider: "openai:whisper-1" },
      prompt: "Projector, TypeScript",
    });

    await browser.evaluate(`window.fixture.commands["ide.agent.roles.set"].run({
      role: "listener",
      provider: "openai:gpt-4o-mini-transcribe"
    })`);
    await wait("window.fixture.saved.length === 2");
    expect(await browser.evaluate("window.fixture.saved[1]")).toEqual({
      selection: { provider: "openai:gpt-4o-mini-transcribe" },
      prompt: "Projector, TypeScript",
    });

    await browser.evaluate(`(() => {
      const card = [...document.querySelectorAll(".role")].find((item) => item.textContent.includes("Listener"));
      [...card.querySelectorAll("button")].find((button) => button.textContent.includes("Автоматически")).click();
    })()`);
    await wait("window.fixture.listen.length === 4");
    expect(
      await browser.evaluate(
        '[...document.querySelectorAll(".role")].find((card) => card.textContent.includes("Listener")).querySelector("textarea").value',
      ),
    ).toBe("");
  },
);
