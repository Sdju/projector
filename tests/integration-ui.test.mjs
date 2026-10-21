import { expect, onTestFinished, test } from "vite-plus/test";
import { createBrowserFixture } from "./fixtures/browser-server.mjs";
import { chromium, createChromium } from "./fixtures/chromium-driver.mjs";

const html = `<!doctype html><div id="settings"></div><div id="connection"></div><pre id="result">WAITING</pre>
<script type="module">
import {createApp,ref,nextTick} from 'vue';
import GithubSettings from '/src/modules/github/GithubSettings.vue';
import GitlabSettings from '/src/modules/gitlab/GitlabSettings.vue';
import {agentCommandHandler} from '/src/modules/agent/model/commands.ts';
import GithubConnection from '/src/modules/github/GithubConnection.vue';
import {createCommandService} from '/core/modules/ide/index.ts';
import {commandHostKey} from '/src/common/utilities/commands.ts';
const check=(value,label)=>{if(!value)throw new Error(label);};
const originalFetch=window.fetch;
const wait=async(condition,label)=>{const until=Date.now()+8000;while(!condition()){if(Date.now()>until)throw new Error(label);await originalFetch('/__tick');}};
let integration={id:'github',name:'GitHub',description:'',enabled:true,settings:{clientId:'client',directory:'/tmp/projects'},connected:false,account:null};
const requests=[];let failLoad=false;
window.fetch=async(input,options={})=>{
 if(typeof input!=='string'||!input.startsWith('/api/integrations'))return originalFetch(input,options);
 await originalFetch('/__tick');
 const body=options.body?JSON.parse(options.body):undefined;
 requests.push({path:input,method:options.method,body});
 if(input==='/api/integrations'&&failLoad)return Response.json({error:'Status unavailable'},{status:503});
 if(input==='/api/integrations')return Response.json({file:'integrations.json',secretStorage:{backend:'file',reason:'disabled'},integrations:[integration,{...integration,id:'gitlab',settings:{url:'https://gitlab.com',directory:'/tmp/projects'}}]});
 if(input==='/api/integrations/github'&&options.method==='PUT'){integration={...integration,enabled:body.enabled,settings:{...integration.settings,...body}};return Response.json(integration);}
 if(input.endsWith('/auth')&&body?.token==='invalid')return Response.json({error:'Invalid credentials'},{status:401});
 if(input.endsWith('/auth')){integration={...integration,connected:options.method!=='DELETE',account:options.method!=='DELETE'?'fixture':null};return Response.json(integration);}
 if(input.endsWith('/device'))return Response.json({id:'login',userCode:'CODE',verificationUri:'https://github.com/login/device',interval:1000,expiresAt:Date.now()+100000});
 throw new Error('Unexpected request '+input);
};
const sdk=createCommandService();const errors=[];
window.addEventListener('unhandledrejection',event=>errors.push(event.reason?.message??String(event.reason)));
const agent=agentCommandHandler(sdk,'local-fixture');
const execute=(command,scope)=>agent({operation:'execute',command,scope});
const host={revision:ref(0),createScope:sdk.createScope,reportError:error=>errors.push(error.message)};
const enter=(input,value)=>{input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};
const scope=integration=>sdk.getScopes().find(item=>item.context.integration===integration).id;
let settings,connection;
(async()=>{try{
 settings=createApp(GithubSettings);settings.provide(commandHostKey,host);settings.mount('#settings');
 await wait(()=>document.querySelector('#settings input[type="password"]'),'settings loaded');
 const settingsScope=scope('github');
 const discovered=await agent({operation:'list',query:'ide.github.integration'});
 check(discovered.commands.some(command=>command.id==='ide.github.integration.save'),'settings discoverable by agent');
 const expected=['save','connect','disconnect','device.start','device.cancel'];
 for(const action of expected)check(sdk.getCommands().some(command=>command.id==='ide.github.integration.'+action&&command.title&&command.description),'registered '+action);
 document.querySelector('#settings [data-command="ide.github.integration.save"]').click();
 await wait(()=>document.querySelector('#settings [role="status"]')?.textContent==='Настройки сохранены','save button');
 await execute('ide.github.integration.device.start',settingsScope);await nextTick();
 check(document.querySelector('#settings .device')?.textContent.includes('CODE'),'device code');
 document.querySelector('#settings [data-command="ide.github.integration.device.cancel"]').click();await nextTick();
 check(!document.querySelector('#settings .device'),'device cancel button');
 enter(document.querySelector('#settings input[type="password"]'),'  settings-secret  ');await nextTick();
 await execute('ide.github.integration.connect',settingsScope);await nextTick();
 check(requests.at(-1).body.token==='settings-secret','settings trims token');
 check(requests.at(-2).body.enabled===true,'settings enables integration');
 check(document.querySelector('#settings input[type="password"]').value==='','settings clears token');
 await execute('ide.github.integration.disconnect',settingsScope);await nextTick();
 check(requests.at(-1).method==='DELETE','disconnect command');
 const enabled=document.querySelector('#settings input[type="checkbox"]');enabled.click();await nextTick();
 await execute('ide.github.integration.save',settingsScope);
 check(!integration.enabled,'integration starts disabled for failed auth');
 enter(document.querySelector('#settings input[type="password"]'),'invalid');await nextTick();
 let failure;try{await execute('ide.github.integration.connect',settingsScope);}catch(error){failure=error;}
 check(failure?.message==='Invalid credentials','failed auth rejects through agent bridge');
 await nextTick();
 check(document.querySelector('#settings [role="alert"]')?.textContent.includes('Invalid credentials'),'failed auth shown');
 check(integration.enabled&&enabled.checked,'successful settings save applied even when auth fails');
 check(document.querySelector('#settings input[type="password"]').value==='invalid','failed auth keeps token draft');

 settings.unmount();settings=null;
 integration.enabled=false;
 let connected=false;
 connection=createApp(GithubConnection,{repository:'owner/repo',onConnected:()=>{connected=true;}});connection.provide(commandHostKey,host);connection.mount('#connection');
 enter(document.querySelector('#connection input[type="password"]'),'  connection-secret  ');await nextTick();
 document.querySelector('#connection button[type="submit"]').click();
 await wait(()=>connected,'connection submit');
 check(requests.at(-1).body.token==='connection-secret','connection trims token');
 check(requests.at(-2).body.enabled===true,'connection enables integration');
 const connectionScope=sdk.getScopes().find(item=>item.context.repository==='owner/repo').id;
 check(!(await agent({operation:'list'})).scopes.some(item=>item.id===connectionScope),'repository connection hidden from other projects');
 const repositoryAgent=agentCommandHandler(sdk,'gh:/owner/repo');
 check((await repositoryAgent({operation:'list'})).commands.some(item=>item.scope===connectionScope),'repository connection visible in own workspace');
 check(errors.length===0,'no command errors');
 connection.unmount();connection=null;
 settings=createApp(GitlabSettings);settings.provide(commandHostKey,host);settings.mount('#settings');
 await wait(()=>document.querySelector('#settings input[type="password"]'),'gitlab settings loaded');
 check((await agent({operation:'list',query:'ide.gitlab.integration'})).commands.some(item=>item.id==='ide.gitlab.integration.save'),'gitlab settings discoverable');
 settings.unmount();settings=null;
 failLoad=true;
 for(const Component of [GithubSettings,GitlabSettings]){
  settings=createApp(Component);settings.provide(commandHostKey,host);settings.mount('#settings');
  await wait(()=>document.querySelector('#settings [role="alert"]')?.textContent.includes('Status unavailable'),'initial failure is displayed');
  await originalFetch('/__tick');
  settings.unmount();settings=null;
 }
 check(errors.length===0,'initial failure does not reject unhandled');
 check(sdk.getScopes().length===0,'scope cleanup');
 document.getElementById('result').textContent='PASS';
}catch(error){document.getElementById('result').textContent='FAIL: '+error.stack;}
finally{settings?.unmount();connection?.unmount();window.fetch=originalFetch;}})();
</script>`;

test(
  "GitHub forms share token connection and expose settings actions as IDE commands",
  { skip: !chromium, timeout: 60000, retry: 2 },
  async () => {
    const fixture = await createBrowserFixture({ pages: { "/__integration_test": html } });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    const dump = (path) => browser.result(fixture.url(path));
    expect(await dump("/__integration_test")).toBe("PASS");
  },
);
