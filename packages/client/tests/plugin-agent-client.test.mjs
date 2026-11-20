import { afterEach, expect, test } from "vite-plus/test";
import IconBot from "~icons/lucide/bot";
import { createApi } from "../modules/plugin-runtime/api.ts";
import { mountAgentUsage } from "../modules/plugin-runtime/mount.ts";
import { createScope } from "../modules/plugin-runtime/scope.ts";
import { findRuntimeAgent, runtimeAgents, runtimeIssues } from "../modules/plugin-runtime/store.ts";
import {
  clientAgentByBackend,
  readTodosPlan,
  registerClientAgent,
} from "../modules/agents-integration/catalog/index.ts";
import { PluginCustomUsageIndicator } from "../modules/agents-integration/usage/index.ts";
import { toolLabel } from "../modules/agent-core/lib/tool-labels.ts";
import { createBrowserFixture } from "../../../tests/fixtures/browser-server.mjs";
import { chromium, createChromium } from "../../../tests/fixtures/chromium-driver.mjs";

afterEach(() => {
  runtimeAgents.value = [];
  runtimeIssues.value = [];
});

const hash = "a".repeat(64);
function pluginInfo(id = "@acme/agent-client") {
  return {
    id,
    version: "1.0.0",
    status: "enabled",
    enabled: true,
    trusted: true,
    hash,
    languages: [],
    panels: [],
    tabs: [],
    agents: [{ id: "acme-bot", title: "Acme", command: "acme" }],
    diagnostics: [],
  };
}

function apiOf(plugin = pluginInfo()) {
  const scope = createScope(plugin.id);
  return { plugin, scope, api: createApi(plugin, scope) };
}

test("api.agents.register contributes plan, tool labels and usage until dispose", async () => {
  const { api, scope } = apiOf();
  registerClientAgent({
    backend: "acme-bot",
    program: "acme",
    title: "Acme",
    caption: "Плагинный агент",
    icon: IconBot,
  });
  const plan = readTodosPlan(["update_todos"]);
  let cleaned = 0;
  let published;
  const registration = api.agents.register({
    id: "acme-bot",
    plan,
    toolLabel: (call) => (call.name === "CustomTool" ? "Свой инструмент" : undefined),
    mountUsage(container, context) {
      context.publishSummary(42, "hot");
      container.textContent = "usage";
      return () => {
        cleaned++;
        container.textContent = "";
      };
    },
  });
  expect(() => api.agents.register({ id: "acme-bot" })).toThrow(/уже зарегистрирован/);
  expect(() => api.agents.register({ id: "missing" })).toThrow(/не объявлен в манифесте/);

  const runtime = findRuntimeAgent("acme-bot");
  expect(runtime?.packageName).toBe("@acme/agent-client");
  expect(
    runtime.plan({
      name: "update_todos",
      input: JSON.stringify({
        todos: [{ content: "one", status: "in_progress", activeForm: "Doing one" }],
      }),
    }),
  ).toEqual([{ content: "one", status: "in_progress", active: "Doing one" }]);
  expect(toolLabel("CustomTool", "", { backend: "acme-bot" })).toBe("Свой инструмент");
  expect(toolLabel("other", "", { backend: "acme-bot" })).toBe("other");

  const agent = clientAgentByBackend("acme-bot");
  expect(agent.plan).toBe(plan);
  expect(agent.toolLabel).toBeTypeOf("function");
  expect(agent.usage).toBe(PluginCustomUsageIndicator);
  expect(agent.usageProps).toMatchObject({
    agentId: "acme-bot",
    title: "Acme",
    packageName: "@acme/agent-client",
    instance: runtime.instance,
  });

  const host = { textContent: "" };
  const disposeMount = mountAgentUsage("acme-bot", host, {
    publishSummary(remaining, tone) {
      published = { remaining, tone };
    },
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(published).toEqual({ remaining: 42, tone: "hot" });
  expect(host.textContent).toBe("usage");
  disposeMount();
  expect(cleaned).toBe(1);
  expect(host.textContent).toBe("");

  registration.dispose();
  expect(findRuntimeAgent("acme-bot")).toBeUndefined();
  expect(clientAgentByBackend("acme-bot").usage).toBeUndefined();
  expect(clientAgentByBackend("acme-bot").plan).toBeUndefined();
  scope.dispose();
  expect(runtimeAgents.value).toEqual([]);
});

test("readTodosPlan keeps activeForm and a generic active string", () => {
  const read = readTodosPlan(["TodoWrite"]);
  expect(
    read({
      name: "TodoWrite",
      input: JSON.stringify({
        todos: [
          { content: "one", status: "completed", activeForm: "Doing one" },
          { title: "two", status: "pending", active: "Waiting" },
        ],
      }),
    }),
  ).toEqual([
    { content: "one", status: "completed", active: "Doing one" },
    { content: "two", status: "pending", active: "Waiting" },
  ]);
});

test("late agent registration is rejected after the plugin is disabled", () => {
  const { api, scope } = apiOf();
  scope.dispose();
  expect(() => api.agents.register({ id: "acme-bot" })).toThrow(/уже выключен/);
});

const settingsHtml = `<!doctype html><html data-appearance="dark"><head>
<meta name="color-scheme" content="dark"></head><body><div id="plugins"></div><pre id="result">WAITING</pre>
<script type="module">
import '/packages/client/app/styles.css';
import {createApp,nextTick,ref} from 'vue';
import PluginSettings from '/packages/client/modules/plugins/PluginSettings.vue';
import {createCommandService} from '/packages/core/modules/ide/index.ts';
import {commandHostKey} from '/packages/client/common/utilities/commands.ts';
const check=(value,label)=>{if(!value)throw new Error(label);};
const originalFetch=window.fetch;
const wait=async(condition,label)=>{const until=Date.now()+8000;while(!condition()){if(Date.now()>until)throw new Error(label);await originalFetch('/__tick');}};
const plugin={
  id:'server-agent',
  version:'1.0.0',
  description:'Cloud ACP plugin',
  status:'enabled',
  enabled:true,
  trusted:true,
  code:true,
  server:'dist/server.js',
  diagnostics:[],
  themes:[],
  languages:[],
  panels:[],
  tabs:[],
  agents:[{id:'remote-bot',title:'Remote Bot',caption:'Cloud agent'}],
  dependencies:{acp:'^0.5.0','@agent/sdk':'1.2.3'},
};
window.fetch=async(input,options={})=>{
  if(String(input).includes('/api/plugins')) return Response.json({directory:'/tmp/plugins',plugins:[plugin],availableThemes:[]});
  if(String(input).includes('/api/agent/backends')) return Response.json({backends:[]});
  return originalFetch(input,options);
};
const sdk=createCommandService();
const host={revision:ref(0),createScope:sdk.createScope,reportError:error=>{throw error;}};
let app;
(async()=>{try{
  app=createApp(PluginSettings);app.provide(commandHostKey,host);app.mount('#plugins');
  await wait(()=>document.querySelectorAll('.plugin-list article').length===1,'plugin list');
  document.querySelector('.plugin-open').click();await nextTick();
  check(document.querySelector('.plugin-details'),'plugin details open');
  check(!document.querySelector('.agent-row code'),'agent without command has no empty code');
  const badges=[...document.querySelectorAll('.plugin-details .ui-badge')].map(item=>item.textContent.trim());
  check(badges.includes('acp@^0.5.0'),'acp dependency');
  check(badges.includes('@agent/sdk@1.2.3'),'sdk dependency');
  check(document.querySelector('.agent-row strong')?.textContent==='Remote Bot','agent title');
  app.unmount();app=null;
  document.getElementById('result').textContent='PASS';
}catch(error){document.getElementById('result').textContent='FAIL: '+error.stack;}
finally{app?.unmount();window.fetch=originalFetch;}})();
</script></body></html>`;

test(
  "Plugin settings render a server agent without a command and list dependencies",
  { skip: !chromium, timeout: 30000 },
  async ({ onTestFinished }) => {
    const fixture = await createBrowserFixture({ pages: { "/__plugin_agent": settingsHtml } });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    expect(await browser.result(fixture.url("/__plugin_agent"))).toBe("PASS");
  },
);
