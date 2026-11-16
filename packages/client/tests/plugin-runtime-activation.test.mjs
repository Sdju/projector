import { expect, test } from "vite-plus/test";
import { pluginPackageKey } from "@ai-projector/core/modules/plugins/index.ts";
import { createBrowserFixture } from "../../../tests/fixtures/browser-server.mjs";
import { chromium, createChromium } from "../../../tests/fixtures/chromium-driver.mjs";

const hash = "c".repeat(64);
const info = (id) => ({
  id,
  version: "1.0.0",
  status: "enabled",
  enabled: true,
  trusted: true,
  hash,
  browser: { entry: "dist/browser.js", key: pluginPackageKey(id), hash },
  languages: [{ id: "language", title: id, extensions: [`.${id}`] }],
  panels: [],
  tabs: [],
  diagnostics: [],
});
const pending = info("pending-plugin");
const fast = info("fast-plugin");
const pendingCode = `export default {apiVersion:1,async activate(api){
 window.pendingApi=api;
 api.languages.register({id:'language',rules:[{pattern:'pending',token:'keyword'}]});
 await new Promise(resolve=>{window.finishPending=resolve;});
 return ()=>{window.pendingCleanups=(window.pendingCleanups||0)+1;};
}};`;
const fastCode = `export default {apiVersion:1,activate(api){
 window.fastActivations=(window.fastActivations||0)+1;
 api.languages.register({id:'language',rules:[{pattern:'fast',token:'keyword'}]});
 let rejected=false;
 try {api.commands.register({id:'ide.workbench.settings.open',title:'Shadow',description:'Bad',run(){}});}catch{rejected=true;}
 if(!rejected)throw new Error('host command namespace was not protected');
 api.commands.register({id:api.commands.prefix+'ping',title:'Ping',description:'Plugin command',run:()=>42});
}};`;
const html = `<!doctype html><link rel="icon" href="data:,"><pre id="result">WAITING</pre>
<script type="module">
import {applyRuntimeCatalog,disposePluginRuntime,findLanguage,runtimeCommands,runtimeIssues} from '/packages/client/modules/plugin-runtime/index.ts';
const check=(value,label)=>{if(!value)throw new Error(label);};
const wait=async(test,label)=>{const end=Date.now()+6000;while(!test()){if(Date.now()>end)throw new Error(label);await fetch('/__tick');}};
try {
 const pending=${JSON.stringify(pending)}; const fast=${JSON.stringify(fast)};
 const starting=applyRuntimeCatalog({plugins:[pending,fast]});
 await wait(()=>window.pendingApi&&window.fastActivations===1,'independent plugin blocked by pending activate');
 const oldApi=window.pendingApi;
 await applyRuntimeCatalog({plugins:[fast]});
 check(oldApi.signal.aborted,'disable must abort pending activation immediately');
 check(!findLanguage('probe.pending-plugin'),'pending language removed');
 check(findLanguage('probe.fast-plugin'),'independent language remains');
 let lateRejected=false;
 try{oldApi.languages.register({id:'language',rules:[{pattern:'late',token:'keyword'}]});}catch{lateRejected=true;}
 check(lateRejected,'late registration rejected');
 window.finishPending(); await starting;
 check(window.pendingCleanups===1,'late result disposed exactly once');
 check(!findLanguage('probe.pending-plugin'),'late result did not restore language');
 check(runtimeCommands.value.length===1&&runtimeCommands.value[0].run()===42,'owned command registered');
 await applyRuntimeCatalog({plugins:[]});
 check(runtimeCommands.value.length===0,'commands removed on disable');
 await applyRuntimeCatalog({plugins:[fast]});
 check(window.fastActivations===2,'same cached module activated again');
 await applyRuntimeCatalog({plugins:[fast]});
 check(window.fastActivations===2,'unchanged catalog does not duplicate activation');
 check(runtimeIssues.value.length===0,JSON.stringify(runtimeIssues.value));
 disposePluginRuntime();
 check(!findLanguage('probe.fast-plugin')&&runtimeCommands.value.length===0,'full disposal clears contributions');
 document.querySelector('#result').textContent='PASS';
}catch(error){document.querySelector('#result').textContent='FAIL: '+error.stack;}
</script>`;

test(
  "pending activation is cancellable and does not block independent plugins",
  { skip: !chromium, timeout: 30000 },
  async ({ onTestFinished }) => {
    const fixture = await createBrowserFixture({
      pages: { "/__activation": html },
      responses: [
        {
          equals: `/api/plugins/assets/${pending.browser.key}/${hash}/browser.js`,
          type: "text/javascript",
          body: pendingCode,
        },
        {
          equals: `/api/plugins/assets/${fast.browser.key}/${hash}/browser.js`,
          type: "text/javascript",
          body: fastCode,
        },
      ],
    });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    expect(await browser.result(fixture.url("/__activation"))).toBe("PASS");
  },
);
