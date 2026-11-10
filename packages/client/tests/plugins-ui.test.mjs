import { expect, test } from "vite-plus/test";
import { createBrowserFixture } from "../../../tests/fixtures/browser-server.mjs";
import { chromium, createChromium } from "../../../tests/fixtures/chromium-driver.mjs";

const html = `<!doctype html><html data-appearance="dark"><head>
<meta name="color-scheme" content="dark"><meta name="theme-color" content="#171716">
</head><body><div id="plugins"></div><pre id="result">WAITING</pre>
<script type="module">
import '/packages/client/app/styles.css';
import {createApp,nextTick,ref} from 'vue';
import PluginSettings from '/packages/client/modules/plugins/PluginSettings.vue';
import {createCommandService} from '/packages/core/modules/ide/index.ts';
import {commandHostKey} from '/packages/client/common/utilities/commands.ts';
const check=(value,label)=>{if(!value)throw new Error(label);};
const originalFetch=window.fetch;
const wait=async(condition,label)=>{const until=Date.now()+8000;while(!condition()){if(Date.now()>until)throw new Error(label);await originalFetch('/__tick');}};
const theme={id:'example/ocean',packageName:'example',title:'Ocean',mode:'dark',tokens:{bg:'#010203','bg-2':'#040506',text:'#fafafa',accent:'#ff0000'}};
const plugin={id:'example',version:'1.0.0',description:'Local test theme',status:'disabled',enabled:false,path:'/tmp/example',diagnostics:[],themes:[theme]};
let failLoad=true;
const posts=[];
const appearancePosts=[];
window.fetch=async(input,options={})=>{
 if(input==='/api/plugins'){
  await originalFetch('/__tick');
  if(options.method==='POST'){
   const body=JSON.parse(options.body);posts.push(body);
   if(body.action==='enable'){plugin.enabled=true;plugin.status='enabled';}
   if(body.action==='disable'){plugin.enabled=false;plugin.status='disabled';}
   if(body.action==='install'){plugin.id=body.path;plugin.status='enabled';plugin.enabled=true;}
  }
  if(failLoad)return Response.json({error:'Catalog unavailable'},{status:500});
  return Response.json({directory:'/tmp/plugins',plugins:[plugin],availableThemes:plugin.enabled?[theme]:[]});
 }
 if(input==='/api/appearance'&&options.method==='PUT'){
  appearancePosts.push(JSON.parse(options.body));
  return Response.json({choice:theme.id});
 }
 if(input==='/api/pick-folder')return Response.json({path:'/tmp/picked-plugin',cancelled:false});
 return originalFetch(input,options);
};
const sdk=createCommandService();
const failures=[];
const host={revision:ref(0),createScope:sdk.createScope,reportError:error=>failures.push(error.message)};
const button=label=>[...document.querySelectorAll('button')].find(item=>item.textContent.trim()===label);
const scope=()=>sdk.getScopes().find(item=>item.context.surface==='plugins').id;
let app;
(async()=>{try{
 app=createApp(PluginSettings);app.provide(commandHostKey,host);app.mount('#plugins');
 await wait(()=>document.querySelector('[role="alert"]')?.textContent.includes('Catalog unavailable'),'load error');
 failLoad=false;
 await sdk.executeCommand('ide.plugins.refresh',undefined,{scope:scope()});
 await wait(()=>document.querySelectorAll('.plugin-list article').length===1,'plugin list');
 check((await sdk.executeCommand('ide.plugins.list',undefined,{scope:scope()})).length===1,'list command');
 document.querySelector('.plugin-open').click();await nextTick();
 check(document.querySelector('.plugin-details'),'plugin details open');
 button('Включить').click();
 await wait(()=>posts.some(item=>item.action==='enable')&&!button('Включить'),'enable');
 await sdk.executeCommand('ide.plugin.theme.apply',{pluginId:'example',themeId:'ocean'},{scope:scope()});
 check(appearancePosts[0].choice==='example/ocean','theme saved');
 check(document.documentElement.style.getPropertyValue('--bg')==='#010203','external token applied');
 check(document.querySelector('meta[name="color-scheme"]').content==='dark','external mode');
 await sdk.executeCommand('ide.plugin.disable',{id:'example'},{scope:scope()});
 check(document.documentElement.dataset.theme==='dark','disabled active theme falls back');
 check(document.documentElement.style.getPropertyValue('--bg')==='','external tokens cleared');
 const input=document.querySelector('input[placeholder="/path/to/theme-plugin"]');
 input.value='/tmp/manual-plugin';input.dispatchEvent(new Event('input',{bubbles:true}));await nextTick();
 button('Установить').click();
 await wait(()=>posts.some(item=>item.action==='install'&&item.path==='/tmp/manual-plugin'),'manual install');
 check(input.value==='','install path cleared');
 button('Установить из папки').click();
 await wait(()=>posts.some(item=>item.action==='install'&&item.path==='/tmp/picked-plugin'),'folder picker install');
 check(failures.length===0,'commands succeed: '+failures.join(','));
 app.unmount();app=null;
 check(sdk.getScopes().length===0,'scope cleanup');
 document.getElementById('result').textContent='PASS';
}catch(error){document.getElementById('result').textContent='FAIL: '+error.stack;}
finally{app?.unmount();window.fetch=originalFetch;}})();
</script></body></html>`;

test.concurrent(
  "Plugin settings manage local themes through scoped IDE commands",
  { skip: !chromium, timeout: 60000, retry: 2 },
  async ({ onTestFinished }) => {
    const fixture = await createBrowserFixture({ pages: { "/__plugins_test": html } });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    expect(await browser.result(fixture.url("/__plugins_test"))).toBe("PASS");
  },
);
