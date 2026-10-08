import { describe, expect, onTestFinished, test } from "vite-plus/test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer, loadConfigFromFile } from "vite-plus";

const chromium = [
  process.env.CHROMIUM_BIN,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
]
  .filter(Boolean)
  .find(existsSync);

const html = `<!doctype html><div id="tracker"></div><div id="docker"></div><div id="usage" style="position:fixed;right:20px;bottom:20px"></div><pre id="result">WAITING</pre>
<script type="module">
import '/src/app/styles.css';
import {createApp,h,ref,nextTick} from 'vue';
import IssueView from '/src/modules/workspace/modules/viewers/ui/IssueView.vue';
import PullRequestView from '/src/modules/workspace/modules/viewers/ui/PullRequestView.vue';
import DiscussionView from '/src/modules/workspace/modules/viewers/ui/DiscussionView.vue';
import {registerWorkspaceProfile} from '/src/modules/workspace-api/index.ts';
import {useDocker} from '/src/modules/docker/model.ts';
import DockerSidebar from '/src/modules/docker/ui/DockerSidebar.vue';
import DockerPanel from '/src/modules/docker/ui/DockerPanel.vue';
import CodexUsageIndicator from '/src/modules/agents-integration/codex/ui/CodexUsageIndicator.vue';
import ClaudeUsageIndicator from '/src/modules/agents-integration/claude/ui/ClaudeUsageIndicator.vue';
import CursorUsageIndicator from '/src/modules/agents-integration/cursor/ui/CursorUsageIndicator.vue';
import OpenCodeUsageIndicator from '/src/modules/agents-integration/opencode/ui/OpenCodeUsageIndicator.vue';
import {agentUsageSummary} from '/src/modules/agents-integration/_/usage-summary.ts';
import {commandHostKey} from '/src/common/utilities/commands.ts';
const check=(value,label)=>{if(!value)throw new Error(label);};
const wait=async(condition,label)=>{const until=Date.now()+8000;while(!condition()){if(Date.now()>until)throw new Error(label);await fetch('/__tick');}};
const author={login:'tester',avatarUrl:''};
const calls=[];
const provider={async read(action,params){
  calls.push([action,params.number]);
  await fetch('/__tick');
  if(params.number==='2')throw new Error('Detail failed');
  const item={title:action+' detail',number:1,state:'open',author,createdAt:'2026-10-07T00:00:00Z',htmlUrl:'',labels:[],body:'',reactions:[],category:{name:'General',emoji:''}};
  return {[action==='pull'?'pull':action]:item,comments:[],reviews:[],files:[]};
}};
registerWorkspaceProfile('reuse-fixture',{id:'test',layout:'editor',features:{},providers:{files:{...provider,assetUrl:()=>''},issues:provider,pulls:provider,discussions:provider}});
const commands=new Map();
const host={revision:ref(0),reportError:error=>{throw error;},createScope(){return{
 activate(){},dispose(){},registerCommand(command){commands.set(command.id,command);return()=>commands.delete(command.id);},
 describe(id,args){const command=commands.get(id);return command&&{...command,enabled:command.enabled?.(args)??true};},
 executeCommand(id,args){return Promise.resolve(commands.get(id).run(args));},resolveKeybinding(){}
}}};
const button=label=>[...document.querySelectorAll('#docker .docker-panel header button')].find(item=>item.textContent===label);
const sidebarRows=()=>document.querySelectorAll('#docker .docker-sidebar .row').length;
const panelRows=()=>document.querySelectorAll('#docker tbody tr').length;
let trackerApp,dockerApp,usageApp,state;
(async()=>{try{
 for(const [action,Component] of [['issue',IssueView],['pull',PullRequestView],['discussion',DiscussionView]]){
  const number=ref(1);
  trackerApp=createApp({render:()=>h(Component,{projectId:'reuse-fixture',number:number.value})});
  trackerApp.mount('#tracker');
  check(!!document.querySelector('#tracker [role="status"]'),action+' loading');
  await wait(()=>document.querySelector('#tracker h2')?.textContent.includes(action+' detail'),action+' detail render');
  check(calls.at(-1)[0]===action&&calls.at(-1)[1]==='1',action+' provider route');
  number.value=2;await nextTick();
  check(!document.querySelector('#tracker article'),action+' clears old content');
  await wait(()=>document.querySelector('#tracker [role="alert"]')?.textContent==='Detail failed',action+' error render');
  number.value=3;await nextTick();
  await wait(()=>!!document.querySelector('#tracker h2'),action+' recovers');
  trackerApp.unmount();trackerApp=null;
 }
 dockerApp=createApp({setup(){
  state=useDocker('reuse-fixture',{enabled:false,open(){},sidebar(){},async terminal(){}});
  state.snapshot.value={enabled:true,connected:true,context:'default',contexts:[],detectedFiles:[],binding:{context:'default',name:'project',files:[],profiles:[],envFiles:[]},containers:[
   {id:'own',project:'project',name:'own',state:'running',ports:[]},
   {id:'other',project:'other',name:'other',state:'running',ports:[]}
  ]};
  return()=>h('div',[h(DockerPanel),h(DockerSidebar)]);
 }});
 dockerApp.provide(commandHostKey,host);dockerApp.mount('#docker');
 check(sidebarRows()===1&&panelRows()===1,'initial project containers');
 button('Все контейнеры').click();await nextTick();
 check(panelRows()===2&&sidebarRows()===1,'all mode leaves sidebar project-scoped');
 state.snapshot.value.context='other-context';await nextTick();
 check(panelRows()===2&&sidebarRows()===0,'context mismatch hides bound project');
 button('Проект').click();await nextTick();
 check(panelRows()===0&&sidebarRows()===0,'project mode respects binding context');
 state.snapshot.value.binding=null;await nextTick();
 check(sidebarRows()===0&&panelRows()===0,'unbound project is empty');
 button('Все контейнеры').click();await nextTick();
 check(panelRows()===2&&sidebarRows()===0,'unbound all mode only shows panel containers');
 dockerApp.unmount();dockerApp=null;
 const originalFetch=window.fetch;
 const requests=[];
 let scenario='ready';
 const quota=(usedPercent,seconds,limited=false)=>({usedPercent,resetsAt:Date.now()/1000+seconds,limited});
 window.fetch=async(input,options)=>{
  if(!['codex','claude','cursor','opencode'].some(provider=>input==='/api/'+provider+'/usage'))return originalFetch(input,options);
  requests.push(input);
  await originalFetch('/__tick');
  if(scenario==='failed')return new Response('',{status:503});
  if(scenario==='unavailable')return Response.json({status:'unavailable',message:'Fixture unavailable'});
  const windows={rolling:quota(20,3600),weekly:quota(40,86400),monthly:quota(10,7*86400),total:quota(20,7*86400),auto:quota(100,7*86400,true),api:quota(70,7*86400)};
  if(scenario==='partial')windows.weekly=null;
  return Response.json({status:'ready',windows,weekly:{...quota(30,86400),windowDurationMins:1440}});
 };
 const adapters=[['codex',CodexUsageIndicator,1,null,70],['claude',ClaudeUsageIndicator,2,'rolling',60],['cursor',CursorUsageIndicator,3,'auto',80],['opencode',OpenCodeUsageIndicator,3,'monthly',60]];
 for(const [provider,Component,rowCount,nextWindow,remaining] of adapters){
  for(scenario of ['ready','unavailable','failed',...(provider==='claude'?['partial']:[])]){
   usageApp=createApp(Component);usageApp.provide(commandHostKey,host);usageApp.mount('#usage');
   const indicator=document.querySelector('#usage .usage-indicator');
   const tooltip=indicator.querySelector('[role="tooltip"]');
   const meter=()=>indicator.querySelector(':scope > .quota-bar');
   check(indicator.getAttribute('aria-describedby')===tooltip.id,provider+' tooltip association');
   check(tooltip.textContent.includes('загрузка')||tooltip.textContent.includes('Загрузка'),provider+' loading text');
   await wait(()=>requests.at(-1)==='/api/'+provider+'/usage'&&!tooltip.textContent.includes('агрузка'),provider+' polling result');
   check(indicator.tagName===(provider==='codex'?'SPAN':'BUTTON'),provider+' interaction semantics');
   if(scenario==='ready'){
    check(meter().getAttribute('aria-valuenow')===String(remaining),provider+' remaining');
    check(tooltip.querySelectorAll('.quota-row').length===rowCount,provider+' tooltip rows');
    indicator.focus();await nextTick();
    check(document.activeElement===indicator,provider+' focusable');
    check(getComputedStyle(tooltip).visibility==='visible',provider+' tooltip on focus');
    check(tooltip.getBoundingClientRect().top>=0,provider+' tooltip stays in viewport');
    check(indicator.querySelector('svg').getBoundingClientRect().width===13,provider+' icon size');
    check(agentUsageSummary[provider].remaining===remaining,provider+' shared summary');
    const before=requests.length;
    if(nextWindow){
     const command=commands.get('ide.'+provider+'.usage.window.cycle');
     check(command.title&&command.description,provider+' command descriptions');
     indicator.click();await nextTick();
     check(indicator.getAttribute('aria-label').includes(provider==='claude'?'5 часов':provider==='cursor'?'Авто':'Месяц'),provider+' click cycles correct window');
     check(requests.length===before,provider+' cycle does not refetch');
     if(provider==='cursor')check(meter().classList.contains('tone-over')&&tooltip.querySelector('.exhausted'),provider+' exhausted window');
    }else{
     indicator.click();await nextTick();
     check(requests.length===before&&meter().getAttribute('aria-valuenow')==='70','Codex never cycles');
     check(meter().classList.contains('tone-over'),'Codex uses API window duration for pace');
    }
   }else if(scenario==='partial'){
    check(!meter().hasAttribute('aria-valuenow')&&tooltip.querySelectorAll('.quota-row').length===1,'Claude missing selected window');
    indicator.click();await nextTick();
    check(meter().getAttribute('aria-valuenow')==='80','Claude available rolling window');
   }else{
    check(!meter().hasAttribute('aria-valuenow')&&tooltip.querySelectorAll('.quota-row').length===0,provider+' unavailable meter');
    check(tooltip.textContent.includes(scenario==='failed'?'не удалось':'Fixture unavailable')||tooltip.textContent.includes('Не удалось'),provider+' failure text');
   }
   usageApp.unmount();usageApp=null;
   check(!agentUsageSummary[provider],provider+' summary cleanup');
  }
 }
 window.fetch=originalFetch;
 document.getElementById('result').textContent='PASS';
}catch(error){document.getElementById('result').textContent='FAIL: '+error.stack;}
finally{trackerApp?.unmount();dockerApp?.unmount();usageApp?.unmount();}})();
</script>`;

test(
  "Shared tracker, Docker and agent quota components preserve provider behavior",
  { skip: !chromium, timeout: 60000, retry: 2 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "projector-component-reuse-"));
    const loaded = await loadConfigFromFile({ command: "serve", mode: "development" });
    const fixture = {
      name: "component-reuse-fixture",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === "/__reuse_test") {
            res.setHeader("Content-Type", "text/html");
            void server.transformIndexHtml(req.url, html).then((body) => res.end(body));
          } else if (req.url === "/__tick") setTimeout(() => res.end("ok"), 20);
          else next();
        });
      },
    };
    const server = await createServer({
      ...loaded.config,
      configFile: false,
      // Never attach Projector's API/PTY server or write its instance file in this fixture.
      plugins: [
        ...loaded.config.plugins.filter((plugin) => plugin.name !== "projector-api"),
        fixture,
      ],
      cacheDir: join(directory, "vite-cache"),
      optimizeDeps: { ...loaded.config.optimizeDeps, entries: [] },
      server: { host: "127.0.0.1", port: 0, strictPort: false },
      logLevel: "error",
    });
    onTestFinished(async () => {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    });
    await server.listen();
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
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
    expect(await dump("/__reuse_test", "tree")).toBe("PASS");
  },
);
