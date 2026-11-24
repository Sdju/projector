import { expect, test } from "vite-plus/test";
import { createBrowserFixture } from "../../../tests/fixtures/browser-server.mjs";
import { chromium, createChromium } from "../../../tests/fixtures/chromium-driver.mjs";

const html = `<!doctype html>
<link rel="icon" href="data:," />
<div id="fixture"></div>
<script type="module">
  import "/packages/client/app/styles.css";
  import { createApp, h, provide, ref } from "vue";
  import { commandHostKey } from "/packages/client/common/utilities/commands.ts";
  import AgentComposer from "/packages/client/modules/agent/modules/composer/ui/AgentComposer.vue";

  const fixture = { calls: 0, submitted: 0, nodes: [], commands: {} };
  let context;
  class Port { onmessage = null; }
  class Node {
    constructor() { this.port = new Port(); fixture.nodes.push(this); }
    connect(target) { return target; }
    disconnect() {}
  }
  class FakeAudioContext {
    sampleRate = 16000;
    state = "running";
    destination = {};
    audioWorklet = { addModule: async () => {} };
    constructor() { context = this; }
    createMediaStreamSource() { return new Node(); }
    createGain() { const node = new Node(); node.gain = { value: 0 }; return node; }
    async resume() {}
    async close() { this.state = "closed"; }
  }
  globalThis.AudioContext = FakeAudioContext;
  globalThis.AudioWorkletNode = Node;
  globalThis.AudioWorkletNode = class extends Node {
    constructor(_context, _name, _options) { super(); }
  };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
  });
  globalThis.fetch = async (url, init = {}) => {
    if (url !== "/api/agent/listener/transcribe") throw new Error("unexpected " + url);
    fixture.calls++;
    const body = JSON.parse(init.body);
    fixture.audio = body.audio;
    if (fixture.calls === 1) return { ok: false, json: async () => ({ error: "временная ошибка" }) };
    return { ok: true, json: async () => ({ text: "распознанный текст", providerName: "Test", model: "whisper-1" }) };
  };
  const scopes = new Map();
  const host = {
    revision: ref(0),
    createScope(id) {
      if (scopes.has(id)) throw new Error("Duplicate scope: " + id);
      const commands = scopes.size ? {} : fixture.commands;
      scopes.set(id, commands);
      return {
        id,
        activate() {},
        registerCommand(command) { commands[command.id] = command; return () => {}; },
        describe() {},
        executeCommand: async (id, args) => commands[id]?.run(args),
        resolveKeybinding() {},
        dispose() { scopes.delete(id); },
      };
    },
    reportError(error) { throw error; },
  };
  const app = createApp({
    setup() {
      provide(commandHostKey, host);
      const draft = ref("");
      const parts = ref([]);
      const renderComposer = () => h(AgentComposer, {
        projectId: "shared-project",
        modelValue: draft.value,
        "onUpdate:modelValue": (value) => { draft.value = value; fixture.draft = value; },
        parts: parts.value,
        "onUpdate:parts": (value) => { parts.value = value; },
        busy: false,
        error: "",
        copied: false,
        onSubmit: () => { fixture.submitted++; },
      });
      return () => [renderComposer(), h("div", { hidden: true }, [renderComposer()])];
    },
  });
  app.mount("#fixture");
  fixture.scopeCount = scopes.size;
  fixture.ready = true;
  window.fixture = fixture;
</script>`;

test.concurrent(
  "dictation records WAV, retries and inserts into the composer",
  { skip: !chromium, timeout: 90000, retry: 1 },
  async ({ onTestFinished }) => {
    const fixture = await createBrowserFixture({ pages: { "/dictation": html } });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    await browser.open(fixture.url("/dictation"));
    expect(await browser.evaluate("window.fixture.scopeCount")).toBe(2);
    const wait = async (expression, ms = 8000) => {
      for (let waited = 0; waited < ms; waited += 50) {
        if (await browser.evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(await browser.evaluate(expression)).toBeTruthy();
    };
    await browser.evaluate(`document.querySelector('[aria-label="Начать диктовку"]').click()`);
    await wait("window.fixture.nodes.length === 3");
    await browser.evaluate(
      `window.fixture.nodes.findLast((node) => typeof node.port.onmessage === "function").port.onmessage({ data: new Float32Array([0, 0.5, -0.5, 0]) })`,
    );
    await browser.evaluate(`document.querySelector('[aria-label="Завершить диктовку"]').click()`);
    await wait("window.fixture.calls === 1 && document.querySelector('.dictation-error')");
    expect(await browser.evaluate("window.fixture.audio.mime")).toBe("audio/wav");
    expect(await browser.evaluate("window.fixture.audio.base64.startsWith('UklGR')")).toBe(true);

    await browser.evaluate(
      `[...document.querySelectorAll('.dictation-error button')].find((button) => button.textContent === 'Повторить').click()`,
    );
    await wait("window.fixture.calls === 2 && window.fixture.draft === 'распознанный текст'");
    expect(await browser.evaluate("document.querySelector('.cm-content').textContent")).toBe(
      "распознанный текст",
    );
    expect(await browser.evaluate("window.fixture.submitted")).toBe(0);

    await browser.evaluate(`window.fixture.commands["ide.dictation.start"].run()`);
    await wait("document.querySelector('[aria-label=\"Завершить диктовку\"]') !== null");
    await browser.evaluate(
      `window.fixture.nodes.findLast((node) => typeof node.port.onmessage === "function").port.onmessage({ data: new Float32Array([0, 0.5]) })`,
    );
    await browser.evaluate(`document.querySelector('[aria-label="Отправить сообщение"]').click()`);
    await wait("window.fixture.submitted === 1");
    expect(await browser.evaluate("window.fixture.calls")).toBe(3);
  },
);
