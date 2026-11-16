import { expect, test } from "vite-plus/test";
import { loginQrSvg } from "../modules/hub/qr.ts";
import { createBrowserFixture } from "../../../tests/fixtures/browser-server.mjs";
import { chromium, createChromium } from "../../../tests/fixtures/chromium-driver.mjs";

test("login QR svg encodes the Hub url as a scannable matrix", () => {
  const first = loginQrSvg(`http://localhost:4180/login?code=${"a".repeat(64)}`);
  const second = loginQrSvg(`http://localhost:4180/login?code=${"b".repeat(64)}`);
  expect(first).toMatch(/^<svg[\s>]/);
  expect(first).toContain("viewBox");
  expect(first).toContain("<path");
  expect(first).not.toBe(second);
});

const html = `<!doctype html><div id="app"></div><pre id="result">WAITING</pre>
<script type="module">
import '/packages/client/app/styles.css';
import {createApp,nextTick,ref} from 'vue';
import HubLoginLink from '/packages/client/modules/hub/HubLoginLink.vue';
import {createCommandService} from '/packages/core/modules/ide/index.ts';
import {commandHostKey} from '/packages/client/common/utilities/commands.ts';
const check=(value,label)=>{if(!value)throw new Error(label);};
const wait=async(condition,label)=>{const until=Date.now()+8000;while(!condition()){if(Date.now()>until)throw new Error(label);await originalFetch('/__tick');}};
const originalFetch=window.fetch;
const posts=[];
window.fetch=async(input,options={})=>{
 if(String(input)==='/api/hub/login-link'){
  posts.push(options.method);
  if(options.method==='POST')return Response.json({url:'http://localhost:4180/login?code='+'a'.repeat(64),ttl:60});
 }
 return originalFetch(input,options);
};
const sdk=createCommandService();
const failures=[];
const host={revision:ref(0),createScope:sdk.createScope,reportError:error=>failures.push(error.message)};
const button=label=>[...document.querySelectorAll('button')].find(item=>item.textContent.trim()===label);
let app;
(async()=>{try{
 app=createApp(HubLoginLink,{available:false});app.provide(commandHostKey,host);app.mount('#app');
 await nextTick();
 check(button('Показать QR-код входа').disabled,'disabled until Hub is connected');
 app.unmount();
 app=createApp(HubLoginLink);app.provide(commandHostKey,host);app.mount('#app');
 await nextTick();
 button('Показать QR-код входа').click();
 await wait(()=>document.querySelector('.qr svg')&&document.querySelector('input').value.includes('login?code='),'qr shown');
 check(posts.at(-1)==='POST','mints via POST');
 check(document.querySelector('.qr').getAttribute('aria-label')==='QR-код входа в Hub','accessible qr');
 button('Скрыть QR-код').click();
 await nextTick();
 check(!document.querySelector('.qr'),'qr hidden');
 check(failures.length===0,'commands succeed: '+failures.join(','));
 document.getElementById('result').textContent='PASS';
}catch(error){document.getElementById('result').textContent='FAIL: '+error.stack;}
finally{app?.unmount();window.fetch=originalFetch;}})();
</script>`;

test.concurrent(
  "Hub login QR is requested through a scoped IDE command",
  { skip: !chromium, timeout: 45000 },
  async ({ onTestFinished }) => {
    const fixture = await createBrowserFixture({ pages: { "/__hub_login_qr": html } });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    expect(await browser.result(fixture.url("/__hub_login_qr"))).toBe("PASS");
  },
);
