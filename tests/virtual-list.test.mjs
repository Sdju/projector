import { expect, onTestFinished, test } from "vite-plus/test";
import { createBrowserFixture } from "./fixtures/browser-server.mjs";
import { chromium, createChromium } from "./fixtures/chromium-driver.mjs";

const html = `<!doctype html><div id="fixture" style="height:400px;display:flex;flex-direction:column"></div><pre id="result">WAITING</pre>
<script type="module">
import '/src/app/styles.css';
import {createApp, h, ref, nextTick} from 'vue';
import KeybindingsTable from '/src/modules/ide/ui/KeybindingsTable.vue';
const rows = ref(Array.from({length:10000}, (_,index) => ({
  command:'ide.test.'+index, title:'Command '+index, index:0, custom:false,
  rule:{command:'ide.test.'+index, key:'Mod+K'}
})));
const resetKey = ref('all');
const when = ref('In command scope');
let lastAction;
const app = createApp({render: () => h(KeybindingsTable, {
  rows:rows.value, busy:false, resetKey:resetKey.value,
  displayKey: key => key || '', condition: () => when.value,
  onAction: (action, row) => { lastAction = [action, row.command]; }
})});
app.mount('#fixture');
const wait = async (condition, label) => {
  const until=Date.now()+8000;
  while(!condition()) {
    if(Date.now()>until) throw new Error(label);
    await fetch('/__tick');
  }
};
const check = (value,label) => {if(!value) throw new Error(label);};
const rendered = () => [...document.querySelectorAll('[data-command]')];
const scroll = document.querySelector('.table-scroll');
(async () => {
 try {
  await wait(() => rendered().length > 0, 'initial rows');
  check(rendered().length < 40, 'bounded DOM for 10000 rows');
  check(document.querySelector('table').getAttribute('aria-rowcount')==='10001', 'logical row count');
  const first = rendered()[0];
  const focus = first.querySelector('button');
  focus.focus();
  await nextTick();
  scroll.scrollTop = 200000;
  await wait(() => rendered().some(row => Number(row.dataset.virtualIndex)>1000), 'middle rows');
  check(first.isConnected && document.activeElement === focus, 'focused row survives scrolling');
  check(rendered().length < 40, 'focus retention keeps bounded DOM');
  focus.blur();
  await wait(() => !first.isConnected, 'released focused row');
  scroll.scrollTop = scroll.scrollHeight;
  await wait(() => document.querySelector('[data-command="ide.test.9999"]'), 'last row reachable');
  const last = document.querySelector('[data-command="ide.test.9999"]');
  last.querySelector('button').click();
  check(lastAction[0]==='edit' && lastAction[1]==='ide.test.9999', 'correct action at end');
  rows.value = [rows.value[9999]];
  resetKey.value = 'filtered';
  await wait(() => rendered().length===1 && scroll.scrollTop===0, 'filter resets scroll');
  const height = rendered()[0].getBoundingClientRect().height;
  when.value = 'Long condition '.repeat(100);
  await wait(() => rendered()[0].getBoundingClientRect().height > height+100, 'dynamic height');
  check(scroll.scrollHeight >= rendered()[0].getBoundingClientRect().height, 'measured scroll extent');
  document.getElementById('fixture').style.width='320px';
  await nextTick();
  check(document.documentElement.scrollWidth===document.documentElement.clientWidth, 'no viewport overflow');
  rows.value = [];
  resetKey.value = 'empty';
  await wait(() => rendered().length===0 && document.body.textContent.includes('Команды не найдены'), 'empty results');
  app.unmount();
  document.getElementById('result').textContent='PASS';
 } catch(error) {document.getElementById('result').textContent='FAIL: '+error.stack;}
})();
</script>`;

test(
  "Virtual list bounds the DOM, measures rows, preserves focus and filters safely",
  {
    skip: !chromium,
    timeout: 60000,
    retry: 2,
  },
  async () => {
    const fixture = await createBrowserFixture({ pages: { "/__virtual_list_test": html } });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    const dump = (path) => browser.result(fixture.url(path));
    expect(await dump("/__virtual_list_test")).toBe("PASS");
  },
);
