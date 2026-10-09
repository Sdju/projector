import { expect, onTestFinished, test } from "vite-plus/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createBrowserFixture } from "./fixtures/browser-server.mjs";

const chromium = [
  process.env.CHROMIUM_BIN,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
]
  .filter(Boolean)
  .find(existsSync);

const html = `<!doctype html><div id="settings"></div><div id="panel"></div><pre id="result">WAITING</pre>
<script type="module">
import '/src/app/styles.css';
import {createApp,h,ref,nextTick} from 'vue';
import NetworkSettings from '/src/modules/network/NetworkSettings.vue';
import LanInfoPanel from '/src/modules/network/LanInfoPanel.vue';
import {createCommandService} from '/core/modules/ide/index.ts';
import {commandHostKey} from '/src/common/utilities/commands.ts';
const check=(value,label)=>{if(!value)throw new Error(label);};
const wait=async(condition,label)=>{const until=Date.now()+8000;while(!condition()){if(Date.now()>until)throw new Error(label);await originalFetch('/__tick');}};
const saved={mode:'lan',passwordRequired:true,lanUrl:'http://192.0.2.1:4177',lanUrls:['http://192.0.2.1:4177','http://192.0.2.2:4177']};
const originalFetch=window.fetch;
const posts=[];
let failLoad=true,failSave=false,hold=false,release;
window.fetch=async(input,options={})=>{
 if(input==='/api/health')return Response.json({pid:10});
 if(input!=='/api/app/network')return originalFetch(input,options);
 await originalFetch('/__tick');
 if(options.method!=='POST')return failLoad?Response.json({error:'Load failed'},{status:500}):Response.json(saved);
 const body=JSON.parse(options.body);posts.push(body);
 if(hold)await new Promise(resolve=>{release=resolve;});
 if(failSave)return Response.json({error:'Save rejected'},{status:403});
 if(body.password!==undefined)saved.passwordRequired=!!body.password;
 return Response.json({ok:true,restarted:false});
};
let clipboardFails=false;
const copied=[];
Object.defineProperty(navigator,'clipboard',{value:{async writeText(address){if(clipboardFails)throw new Error('Clipboard failed');copied.push(address);}},configurable:true});
const sdk=createCommandService();
const failures=[];
const host={revision:ref(0),createScope:sdk.createScope,reportError:error=>failures.push(error.message)};
const button=(selector,label)=>[...document.querySelectorAll(selector+' button')].find(item=>item.textContent.trim()===label);
const password=selector=>document.querySelector(selector+' input[type="password"]');
const enter=(input,value)=>{input.focus();input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};
const scope=view=>sdk.getScopes().find(item=>item.context.view===view).id;
let settingsApp,panelApp;
(async()=>{try{
 settingsApp=createApp(NetworkSettings);settingsApp.provide(commandHostKey,host);settingsApp.mount('#settings');
 await wait(()=>document.querySelector('#settings [role="status"]')?.textContent==='Load failed','load error');
 check(button('#settings','Сохранить и перезапустить').disabled,'save disabled until ready');
 failLoad=false;
 await sdk.executeCommand('ide.network.refresh',undefined,{scope:scope('settings')});await nextTick();
 panelApp=createApp(LanInfoPanel);panelApp.provide(commandHostKey,host);panelApp.mount('#panel');
 await wait(()=>document.querySelectorAll('#panel .addresses li').length===2,'LAN addresses');
 check(sdk.getScopes().length===2,'separate scopes');
 button('#panel','копировать').click();
 await wait(()=>copied.length===1,'copy LAN address');
 check(copied[0]===saved.lanUrls[0],'copy button uses listed URL');
 await sdk.executeCommand('ide.network.address.copy',{address:saved.lanUrls[1]},{scope:scope('panel')});
 check(copied[1]===saved.lanUrls[1],'explicit copy address');
 let invalidCopy=false;
 try{await sdk.executeCommand('ide.network.address.copy',{address:'http://unlisted.invalid'},{scope:scope('panel')});}catch{invalidCopy=true;}
 check(invalidCopy&&copied.length===2,'copy rejects unrelated URL');
 clipboardFails=true;
 let rejectedCopy=false;
 try{await sdk.executeCommand('ide.network.address.copy',undefined,{scope:scope('panel')});}catch{rejectedCopy=true;}
 check(rejectedCopy,'clipboard failure rejects SDK command');
 clipboardFails=false;
 for(const selector of ['#settings','#panel']){
  const input=password(selector);const label=document.querySelector(selector+' label[for="'+input.id+'"]');
  check(!!label,selector+' accessible password label');
  enter(input,selector==='#settings'?'settings draft':'panel replacement');await nextTick();
  check(sdk.getActiveScope()===scope(selector==='#settings'?'settings':'panel'),selector+' focus activates scope');
 }
 const save=button('#panel','Сохранить');
 hold=true;save.click();
 await wait(()=>!!release,'save request in progress');
 check(save.disabled&&password('#panel').disabled,'controls disabled while busy');
 check(password('#settings').value==='settings draft','other draft preserved');
 release();hold=false;
 await wait(()=>document.querySelector('#panel [role="status"]')?.textContent==='Сохранено','save succeeds');
 check(posts.at(-1).mode==='lan'&&posts.at(-1).password==='panel replacement','panel payload');
 check(password('#panel').value==='','password cleared after success');
 enter(password('#settings'),'');await nextTick();
 button('#settings','Сохранить и перезапустить').click();
 await wait(()=>posts.length===2&&!button('#settings','Сохранить и перезапустить').disabled,'settings save');
 check(!('password' in posts.at(-1)),'empty settings input preserves password');
 button('#settings','Убрать пароль').click();
 await wait(()=>!button('#settings','Убрать пароль'),'remove password updates state');
 check(posts.at(-1).password==='','explicit password clear');
 failSave=true;enter(password('#panel'),'retry draft');await nextTick();save.click();
 await wait(()=>document.querySelector('#panel [role="status"]')?.textContent==='Save rejected','save error');
 check(password('#panel').value==='retry draft'&&!save.disabled,'failed save preserves editable draft');
 failSave=false;save.click();
 await wait(()=>password('#panel').value==='','retry save succeeds');
 check(failures.length===1&&failures[0]==='Save rejected','command errors reported');
 await sdk.executeCommand('ide.network.refresh',undefined,{scope:scope('panel')});
 await sdk.executeCommand('ide.network.save',{password:'agent replacement'},{scope:scope('panel')});
 check(posts.at(-1).password==='agent replacement','explicit SDK arguments');
 check(sdk.getCommands().filter(item=>item.id==='ide.network.save').every(item=>item.description.includes('терминалы')),'restart consequences documented');
 settingsApp.unmount();settingsApp=null;panelApp.unmount();panelApp=null;
 check(sdk.getScopes().length===0,'scope cleanup');
 document.getElementById('result').textContent='PASS';
}catch(error){document.getElementById('result').textContent='FAIL: '+error.stack;}
finally{settingsApp?.unmount();panelApp?.unmount();window.fetch=originalFetch;}})();
</script>`;

test(
  "Network settings and LAN panel save through scoped IDE commands",
  { skip: !chromium, timeout: 60000, retry: 2 },
  async () => {
    const fixture = await createBrowserFixture({ pages: { "/__network_test": html } });
    onTestFinished(() => fixture.close());
    const { directory, base } = fixture;
    const dump = async (path, profile) => {
      const { stdout, stderr } = await promisify(execFile)(
        chromium,
        [
          "--headless",
          "--no-sandbox",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${join(directory, profile)}`,
          "--virtual-time-budget=15000",
          "--dump-dom",
          `${base}${path}`,
        ],
        { timeout: 25000, maxBuffer: 2 * 1024 * 1024 },
      );
      return (
        stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1] ??
        stdout.slice(-2000) + stderr.slice(-1000)
      );
    };
    expect(await dump("/__network_test", "network")).toBe("PASS");
  },
);
