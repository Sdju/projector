import assert from "node:assert/strict";
import { test } from "node:test";
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

const html = `<!doctype html><div id="tracker"></div><div id="docker"></div><pre id="result">WAITING</pre>
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
let trackerApp,dockerApp,state;
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
 document.getElementById('result').textContent='PASS';
}catch(error){document.getElementById('result').textContent='FAIL: '+error.stack;}
finally{trackerApp?.unmount();dockerApp?.unmount();}})();
</script>`;

test(
  "Shared tracker adapters render details and Docker sidebar stays project-scoped",
  { skip: chromium ? false : "Set CHROMIUM_BIN for browser test", timeout: 60000 },
  async (t) => {
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
    t.after(async () => {
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
    assert.equal(await dump("/__reuse_test", "tree"), "PASS");
  },
);
