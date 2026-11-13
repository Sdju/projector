import { expect, test } from "vite-plus/test";
import { pluginPackageKey } from "@ai-projector/core/modules/plugins/index.ts";
import { createBrowserFixture } from "../../../tests/fixtures/browser-server.mjs";
import { chromium, createChromium } from "../../../tests/fixtures/chromium-driver.mjs";

const packageName = "@projector-tests/workspace-ui";
const hash = "b".repeat(64);
const key = pluginPackageKey(packageName);
const plugin = {
  id: packageName,
  version: "1.0.0",
  status: "enabled",
  enabled: true,
  trusted: true,
  hash,
  browser: { entry: "dist/browser.js", key, hash },
  diagnostics: [],
  languages: [{ id: "fict", title: "Fixture Fict", extensions: [".fict"] }],
  panels: [{ id: "inspector", title: "Fixture Inspector", placement: "aside" }],
  tabs: [{ id: "overview", title: "Fixture Overview" }],
};
const code = `export default {apiVersion:1,activate(api){
  window.pluginProbe ??= {mounts:0,cleanups:0,stops:0};
  api.languages.register({id:'fict',rules:[{pattern:'let\\\\b',token:'keyword'},{pattern:'[0-9]+',token:'number'}]});
  const command=api.commands.prefix+'echo';
  api.commands.register({id:command,title:'Echo plugin command',description:'Returns arguments to the plugin view',run:args=>({probe:args.probe,value:42})});
  const mount = (name) => (container,ctx) => {
    window.pluginProbe.mounts++;
    const input = document.createElement('input'); input.dataset.pluginProbe=name;
    input.setAttribute('aria-label','Plugin draft'); input.value='draft'; container.append(input);
    const button=document.createElement('button');button.dataset.pluginCommand=name;button.textContent='Run plugin command';
    button.addEventListener('click',async()=>{try{window.pluginCommandResult=await ctx.commands.run(command,{probe:name});}catch(error){window.pluginCommandError=String(error);}});container.append(button);
    return () => { window.pluginProbe.cleanups++; container.replaceChildren(); };
  };
  api.panels.register({id:'inspector',mount:mount('panel')}); api.tabs.register({id:'overview',mount:mount('tab')});
  return () => { window.pluginProbe.stops++; };
}};`;
const html = `<!doctype html><html><head><link rel="icon" href="data:,"></head><body style="margin:0"><div id="header-tools"></div><div id="app" style="height:850px;display:flex;flex-direction:column"></div>
<script type="module">
import '/packages/client/app/styles.css';
import {createApp,h} from 'vue';
import {EditorView} from '@codemirror/view';
import {provideIdeCommands} from '/packages/client/modules/ide/index.ts';
import {registerWorkspaceProfile} from '/packages/client/modules/workspace-api/index.ts';
import ProjectWorkspace from '/packages/client/modules/workspace/ui/ProjectWorkspace.vue';
import {applyRuntimeCatalog,runtimeIssues,pluginPanelCommandId,pluginTabCommandId} from '/packages/client/modules/plugin-runtime/index.ts';
let ide;
registerWorkspaceProfile('plugin-fixture',{
 id:'fixture',layout:'editor',features:{terminals:false,docker:false,agent:false,settings:false,persist:false,externalFiles:false},
 providers:{files:{assetUrl:path=>path,read:async(action)=>{
   if(action==='file')return {path:'probe.fict',content:'let count = 42;',kind:'text'};
   if(action==='root')return {root:'/tmp/plugin-fixture'};
   return {entries:[],items:[],children:[],total:0,truncated:false};
 },write:async()=>({})}}
});
const app=createApp({setup(){ide=provideIdeCommands(); return ()=>h(ProjectWorkspace,{projectId:'plugin-fixture'});}});
const vueErrors=[];
app.config.errorHandler=(error,instance,info)=>{
 const summarize=node=>({type:typeof node.type==='string'?node.type:node.type?.__file||node.type?.__name||String(node.type),key:node.key,flag:node.shapeFlag,component:!!node.component,tag:node.el?.tagName});
 vueErrors.push({message:String(error),info,component:instance?.$options.__file,children:instance?.$.subTree?.dynamicChildren?.map(summarize)});
};
app.mount('#app');
const sdk=window.projector.ide;
const run=(id,args)=>sdk.executeCommand(id,args,{scope:sdk.getScopes().find(scope=>scope.context.surface==='editor').id});
window.fixture={ready:true,sdk,run,vueErrors,editor:()=>EditorView.findFromDOM(document.querySelector('.cm-editor')),get failures(){return ide.error.value?[ide.error.value]:[]},runtimeIssues,app,
 enable:()=>applyRuntimeCatalog({plugins:[${JSON.stringify(plugin)}]}),
 disable:()=>applyRuntimeCatalog({plugins:[]}),
 openTab:()=>run(pluginTabCommandId(${JSON.stringify(packageName)},'overview')),
 openPanel:()=>run(pluginPanelCommandId(${JSON.stringify(packageName)},'inspector')),
};
</script></body></html>`;

test(
  "browser plugin contributes real workspace panels, tabs and editor highlighting with cleanup",
  { skip: !chromium, timeout: 60000, retry: 1 },
  async ({ onTestFinished }) => {
    const fixture = await createBrowserFixture({
      pages: { "/__plugin_workspace": html },
      responses: [
        {
          equals: `/api/plugins/assets/${key}/${hash}/browser.js`,
          type: "text/javascript",
          body: code,
        },
        { equals: "/api/ide/keybindings", type: "application/json", body: '{"bindings":[]}' },
        { startsWith: "/api/", type: "application/json", body: "{}" },
      ],
    });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    await browser.viewport(1440, 1000);
    await browser.open(fixture.url("/__plugin_workspace"));
    await browser.evaluate("window.fixture.enable()");
    expect(await browser.evaluate("window.fixture.runtimeIssues.value")).toEqual([]);
    const waitFor = async (expression) => {
      const deadline = Date.now() + 8000;
      while (!(await browser.evaluate(expression))) {
        if (Date.now() > deadline)
          throw new Error(
            `Not rendered: ${expression}\n${JSON.stringify(browser.errors)}\n${JSON.stringify(await browser.evaluate("({vue:window.fixture.vueErrors,result:window.pluginCommandResult,error:window.pluginCommandError,hit:window.commandHit})"))}`,
          );
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    };
    await browser.evaluate("window.fixture.run('ide.editor.path.open',{path:'probe.fict'})");
    await waitFor(
      "document.querySelector('.editor-status-line')?.textContent.includes('Fixture Fict')",
    );
    await waitFor(
      "[...document.querySelectorAll('.cm-line span')].some(span=>span.textContent==='42')",
    );
    await browser.evaluate(
      "window.fixture.savedEditor=window.fixture.editor(); window.fixture.savedEditor.dispatch({changes:{from:0,insert:'edited '},selection:{anchor:7}})",
    );
    await browser.evaluate("window.fixture.disable()");
    await waitFor(
      "!document.querySelector('.editor-status-line')?.textContent.includes('Fixture Fict')",
    );
    expect(
      await browser.evaluate(
        "window.fixture.savedEditor===window.fixture.editor() && window.fixture.editor().state.doc.toString().startsWith('edited ') && window.fixture.editor().state.selection.main.anchor===7",
      ),
    ).toBe(true);
    await browser.evaluate("window.fixture.enable()");
    await waitFor(
      "document.querySelector('.editor-status-line')?.textContent.includes('Fixture Fict')",
    );
    expect(await browser.evaluate("window.fixture.savedEditor===window.fixture.editor()")).toBe(
      true,
    );
    await browser.evaluate("window.fixture.openTab()");
    await waitFor("document.querySelector('input[data-plugin-probe=tab]')");
    await browser.click("input[data-plugin-probe=tab]");
    await browser.key("End");
    await browser.call("Input.insertText", { text: " retained" });
    await browser.evaluate(
      "(() => {const button=document.querySelector('button[data-plugin-command=tab]');const r=button.getBoundingClientRect();window.commandHit={rect:{x:r.x,y:r.y,w:r.width,h:r.height},hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML?.slice(0,500)};})()",
    );
    await browser.click("button[data-plugin-command=tab]");
    await waitFor("window.pluginCommandResult?.probe==='tab'");
    expect(await browser.evaluate("window.pluginCommandResult")).toEqual({
      probe: "tab",
      value: 42,
    });
    const mounts = await browser.evaluate("window.pluginProbe.mounts");
    await browser.evaluate("window.fixture.openPanel()");
    await waitFor("document.querySelectorAll('input[data-plugin-probe]').length===2");
    await browser.click("button[data-plugin-command=panel]");
    await waitFor("window.pluginCommandResult?.probe==='panel'");
    expect(await browser.evaluate("window.pluginCommandResult")).toEqual({
      probe: "panel",
      value: 42,
    });
    await browser.evaluate("window.fixture.run('ide.workbench.aside.toggle')");
    await browser.evaluate("window.fixture.openPanel()");
    expect(await browser.evaluate("window.pluginProbe.mounts")).toBe(mounts);
    expect(
      await browser.evaluate(
        "[...document.querySelectorAll('input[data-plugin-probe]')].some(input=>input.value==='draft retained')",
      ),
    ).toBe(true);
    const stops = await browser.evaluate("window.pluginProbe.stops");
    await browser.evaluate("window.fixture.disable()");
    await waitFor("document.querySelectorAll('input[data-plugin-probe]').length===0");
    expect(await browser.evaluate("window.pluginProbe.cleanups")).toBe(mounts);
    expect(await browser.evaluate("window.pluginProbe.stops")).toBe(stops + 1);
    await browser.evaluate("window.fixture.enable()");
    await browser.evaluate("window.fixture.openTab()");
    await waitFor("document.querySelectorAll('input[data-plugin-probe]').length>=1");
    expect(await browser.evaluate("window.fixture.failures")).toEqual([]);
    await browser.evaluate("window.fixture.disable()");
    expect(await browser.evaluate("window.fixture.vueErrors")).toEqual([]);
    expect(browser.errors.filter((error) => error.exception)).toEqual([]);
    await browser.evaluate("window.fixture.app.unmount()");
    expect(await browser.evaluate("window.fixture.sdk.getScopes().length")).toBe(0);
  },
);
