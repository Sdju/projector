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

const html = `<!doctype html><div id="fixture" style="height:400px;overflow:auto"></div><pre id="result">WAITING</pre>
<script type="module">
import '/src/app/styles.css';
import {createApp,h,ref} from 'vue';
import FileTree from '/src/modules/workspace/modules/tree/ui/FileTree.vue';
import {registerWorkspaceProfile} from '/src/modules/workspace-api/index.ts';
import {commandHostKey} from '/src/common/utilities/commands.ts';
import {treePageRange} from '/core/modules/workspace/index.ts';
const calls=[];
let fail=false;
const files=(path,count)=>Array.from({length:count},(_,index)=>({name:'file-'+String(index).padStart(4,'0'),path:(path?path+'/':'')+'file-'+String(index).padStart(4,'0'),directory:false}));
const data={'':[...Array.from({length:2},(_,i)=>({name:'folder-'+i,path:'folder-'+i,directory:true})),...files('',1300)],'folder-0':files('folder-0',65),'folder-1':files('folder-1',65)};
registerWorkspaceProfile('paging-fixture',{
 id:'test',layout:'editor',features:{persist:false},
 providers:{files:{assetUrl:()=>'',async read(action,params){
   calls.push(params);
   await fetch('/__tick');
   if(fail) {fail=false;throw new Error('Page failed');}
   const entries=data[params.path];const page=treePageRange(entries,params.path,params);
   return {entries:entries.slice(page.offset,page.end),total:page.total,nextOffset:page.nextOffset,truncated:page.nextOffset!==null};
 }}}
});
const commands=new Map();
const host={revision:ref(0),reportError:error=>{throw error;},createScope(){return{
 activate(){},dispose(){},registerCommand(command){commands.set(command.id,command);return()=>commands.delete(command.id);},
 describe(id,args){const command=commands.get(id);return command&&{...command,enabled:command.enabled?.(args)??true};},
 executeCommand(id,args){return Promise.resolve(commands.get(id).run(args));},resolveKeybinding(){}
}}};
const tree=ref();const revision=ref(0);
const app=createApp({render:()=>h(FileTree,{ref:tree,projectId:'paging-fixture',selected:'',revision:revision.value})});
app.provide(commandHostKey,host);app.mount('#fixture');
const wait=async(condition,label)=>{const until=Date.now()+8000;while(!condition()){if(Date.now()>until)throw new Error(label);await fetch('/__tick');}};
const check=(value,label)=>{if(!value)throw new Error(label);};
const branch=path=>document.querySelector('ul[aria-label="'+(path||'Файлы проекта')+'"]');
const rows=path=>[...branch(path).children].filter(li=>li.querySelector(':scope > button[data-path]'));
const more=path=>branch(path).querySelector(':scope > li > button[data-tree-more]');
(async()=>{try{
 await wait(()=>rows('').length===30,'initial page');
 check(calls[0].limit==='30','bounded request');
 document.querySelector('[data-path="folder-0"]').click();
 await wait(()=>branch('folder-0')&&rows('folder-0').length===30,'nested initial');
 document.querySelector('[data-path="folder-1"]').click();
 await wait(()=>branch('folder-1')&&rows('folder-1').length===30,'independent branch');
 const last=rows('folder-0').at(-1).querySelector('button');last.focus();
 last.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
 check(document.activeElement===more('folder-0'),'arrow reaches load more');
 more('folder-0').click();
 await wait(()=>rows('folder-0').length===60,'nested second page');
 check(rows('folder-1').length===30&&rows('').length===30,'only target parent grows');
 check(document.activeElement.dataset.path==='folder-0/file-0030','focus first new item');
 more('folder-0').click();await wait(()=>rows('folder-0').length===65&&!more('folder-0'),'last partial page');
 fail=true;more('').click();await wait(()=>document.body.textContent.includes('Page failed'),'page error');
 check(rows('').length===30&&more(''),'error preserves old rows and retry');
 more('').click();await wait(()=>rows('').length===60,'retry page');
 revision.value++;await wait(()=>calls.at(-1).offset==='0'&&rows('').length===60,'refresh preserves portions');
 tree.value.reveal('folder-1/file-0064');
 await wait(()=>document.activeElement.dataset.path==='folder-1/file-0064','reveal nested hidden row');
 check(rows('folder-1').length===65,'reveal opens required portions');
 tree.value.reveal('file-1200');
 await wait(()=>document.activeElement.dataset.path==='file-1200','reveal past old 1000 cap');
 check(calls.some(call=>call.reveal==='file-1200'),'provider receives reveal');
 app.unmount();document.getElementById('result').textContent='PASS';
}catch(error){document.getElementById('result').textContent='FAIL: '+error.stack;}})();
</script>`;

test(
  "File tree loads 30 children per parent, retries, navigates and reveals hidden files",
  { skip: chromium ? false : "Set CHROMIUM_BIN for browser test", timeout: 60000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "projector-tree-paging-"));
    const loaded = await loadConfigFromFile({ command: "serve", mode: "development" });
    const fixture = {
      name: "tree-paging-fixture",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === "/__tree_test") {
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
    assert.equal(await dump("/__tree_test", "tree"), "PASS");
  },
);
