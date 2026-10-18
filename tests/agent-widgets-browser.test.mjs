import { expect, onTestFinished, test } from "vite-plus/test";
import { readFile, writeFile } from "node:fs/promises";
import { createBrowserFixture } from "./fixtures/browser-server.mjs";
import { chromium, createChromium } from "./fixtures/chromium-driver.mjs";

const message = `## Квартал в цифрах

<Card>
  <div style="display:flex;gap:32px;flex-wrap:wrap">
    <Stat label="Выручка" value="4,2 млн" :delta="12" hint="к прошлому кварталу" />
    <Stat label="Расходы" value="2,9 млн" :delta="-4" />
    <Stat label="Клиенты" value="1 380" :delta="7" />
  </div>
</Card>

Динамика по месяцам, переключатель меняет ряд:

<Card>
  <script>
    const mode = ref("Выручка");
    const data = { "Выручка": [120, 135, 150, 148, 170, 190], "Расходы": [90, 95, 100, 120, 118, 125] };
    const series = computed(() => [{ name: mode.value, data: data[mode.value] }]);
    return { mode, series };
  </script>
  <Tabs v-model="mode" :options="['Выручка', 'Расходы']" />
  <Line :labels="['Янв','Фев','Мар','Апр','Май','Июн']" :series="series" />
</Card>

Структура расходов и приоритеты:

<Card>
  <Donut center="2,9 млн" :items="[{label:'Зарплаты',value:55},{label:'Облако',value:20},{label:'Маркетинг',value:15},{label:'Прочее',value:10}]" />
  <Bars unit=" тыс." :items="[{label:'Облако',value:580},{label:'Маркетинг',value:435},{label:'Прочее',value:290}]" />
</Card>

Калькулятор накоплений:

<Card>
  <script>
    const monthly = ref(20000);
    const rate = ref(8);
    const years = ref(10);
    const total = computed(() => {
      const r = rate.value / 100 / 12, n = years.value * 12;
      return Math.round(monthly.value * ((Math.pow(1 + r, n) - 1) / r)).toLocaleString("ru-RU");
    });
    const clicks = ref(0);
    return { monthly, rate, years, total, clicks };
  </script>
  <Slider v-model="monthly" label="Взнос в месяц" :min="5000" :max="100000" :step="5000" unit=" ₽" />
  <Slider v-model="rate" label="Доходность" :min="1" :max="20" unit="%" />
  <Slider v-model="years" label="Срок" :min="1" :max="30" unit=" лет" />
  <strong id="total">Итого: {{ total }} ₽</strong>
  <Button id="count" @click="clicks++">Нажато: {{ clicks }}</Button>
</Card>

<Steps :items="[{title:'Собрать данные',done:true},{title:'Построить отчёт',text:'Графики выше',done:true},{title:'Согласовать'}]" />

Готово.`;

test(
  "widgets stream without remounting, stay interactive and render charts",
  { skip: !chromium, timeout: 90000, retry: 1 },
  async () => {
    const html = await readFile(new URL("./fixtures/agent-widgets.html", import.meta.url), "utf8");
    const fixture = await createBrowserFixture({ pages: { "/widgets": html } });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    await browser.open(fixture.url("/widgets"));
    await browser.viewport(900, 1900);
    const wait = async (expression, ms = 8000) => {
      for (let waited = 0; waited < ms; waited += 50) {
        if (await browser.evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(await browser.evaluate(expression)).toBeTruthy();
    };
    const shot = async (name) => {
      const { data } = await browser.call("Page.captureScreenshot", { format: "png" });
      await writeFile(`/tmp/${name}.png`, Buffer.from(data, "base64"));
    };
    const set = (value, live) =>
      browser.evaluate(`window.fixture.set(${JSON.stringify(value)}, ${live})`);

    // Only the user's own click may message the agent: a mount hook, a watcher or a programmatic
    // click on a button sends nothing. (This runs first: browsers keep a click "fresh" for seconds.)
    await set(
      `<Card>
  <script>
    const n = ref(0);
    onMounted(() => reply("из onMounted"));
    watch(n, () => reply("из watch"));
    return { n };
  </script>
  <Button id="quick" send="Да, продолжай" summary="Ответ">Продолжить</Button>
  <Button id="bump" @click="n++">+</Button>
</Card>`,
      false,
    );
    await wait('document.querySelector("#quick") !== null');
    await browser.evaluate('document.querySelector("#bump").click()');
    await browser.evaluate('document.querySelector("#quick").click()');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await browser.evaluate("window.fixture.replies")).toEqual([]);
    expect(await browser.evaluate('document.querySelector("#quick").textContent.trim()')).toBe(
      "Продолжить",
    );
    await browser.click("#quick");
    await wait('document.querySelector("#quick").textContent.includes("Отправлено")');
    expect(await browser.evaluate("window.fixture.replies")).toEqual(["Ответ\n\nДа, продолжай"]);
    expect(await browser.evaluate('document.querySelector("#quick").disabled')).toBe(true);
    await browser.evaluate("window.fixture.replies.length = 0");

    // Options come as strings or as { value, label, hint } objects, whichever the model writes.
    await set(
      `<Card>
  <Tabs :options="[{value:'a',label:'Альфа',hint:'первый'},'бета']" />
  <Checks :options="['один',{value:'two',label:'Два'}]" />
</Card>`,
      false,
    );
    await wait('document.querySelector("[role=tab]") !== null');
    expect(
      await browser.evaluate(
        "[...document.querySelectorAll('[role=tab]')].map((t) => t.textContent.trim())",
      ),
    ).toEqual(["Альфа", "бета"]);
    expect(
      await browser.evaluate("document.querySelector('.checks').innerText.includes('{')"),
    ).toBe(false);
    expect(
      await browser.evaluate(
        "[...document.querySelectorAll('.checks label')].map((l) => l.innerText.trim())",
      ),
    ).toEqual(["один", "Два"]);

    // Layouts: Card with a title, Columns that stack when narrow, Tabs with panels that keep state.
    await set(
      `<Card title="Сводка" hint="за квартал">
  <Columns :cols="2">
    <Stat id="left" label="Слева" value="1" />
    <Stat id="right" label="Справа" value="2" />
    <Line :labels="['a','b','c']" :series="[{name:'s',data:[1,3,2]}]" />
    <Bars :items="[{label:'x',value:2}]" />
  </Columns>
  <Tabs>
    <Tab title="Данные"><Input id="typed" label="Заметка" /></Tab>
    <Tab title="График"><Bars :items="[{label:'a',value:1}]" /></Tab>
  </Tabs>
  <Form>
    <Tabs>
      <Tab title="Один"><Input name="a" initial="первый" /></Tab>
      <Tab title="Два"><Input name="b" initial="второй" /></Tab>
    </Tabs>
    <Button id="send-layout" submit>Отправить</Button>
  </Form>
</Card>`,
      false,
    );
    await wait('document.querySelectorAll("[role=tab]").length === 4');
    expect(await browser.evaluate("document.querySelector('.ui-card .title').textContent")).toBe(
      "Сводка",
    );
    const box = (selector) =>
      browser.evaluate(
        `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; })()`,
      );
    let left = await box("#left");
    let right = await box("#right");
    expect(right.x).toBeGreaterThan(left.x + 50);
    expect(Math.abs(right.y - left.y)).toBeLessThan(2);
    // The chart keeps its natural height (so its text keeps its size) in a half-width column.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const chartHeight = await browser.evaluate(
      "document.querySelector('.columns svg').getBoundingClientRect().height",
    );
    expect(chartHeight).toBeGreaterThan(150);
    expect(chartHeight).toBeLessThan(175);
    await browser.viewport(360, 1900);
    await new Promise((resolve) => setTimeout(resolve, 300));
    left = await box("#left");
    right = await box("#right");
    expect(right.y).toBeGreaterThan(left.y + 20);
    await browser.viewport(900, 1900);
    // Panels: the first is shown, switching hides it without losing what was typed.
    const shown = () =>
      browser.evaluate(
        "[...document.querySelectorAll('[role=tabpanel]')].map((p) => p.style.display !== 'none')",
      );
    expect((await shown()).slice(0, 2)).toEqual([true, false]);
    await browser.evaluate(
      `(() => { const i = document.querySelector("#typed input, input#typed") ?? document.querySelector("[role=tabpanel] input"); i.value = "осталось"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`,
    );
    await browser.click("[role=tab]:nth-of-type(2)");
    await wait("[...document.querySelectorAll('[role=tabpanel]')][0].style.display === 'none'");
    await browser.click("[role=tab]");
    await wait("[...document.querySelectorAll('[role=tabpanel]')][0].style.display !== 'none'");
    expect(await browser.evaluate("document.querySelector('[role=tabpanel] input').value")).toBe(
      "осталось",
    );
    // Both panels of a tabbed form are fields of that form, shown or not.
    await browser.click("#send-layout");
    await wait('document.querySelector("#send-layout").textContent.includes("Отправлено")');
    const layoutReply = await browser.evaluate("window.fixture.replies.at(-1)");
    expect(JSON.parse(layoutReply.split("```json\n")[1].split("\n```")[0])).toEqual({
      a: "первый",
      b: "второй",
    });
    await browser.evaluate("window.fixture.replies.length = 0");
    await shot("widgets-4-layout");

    // A form needs no script: named controls, preset / reset / submit buttons.
    await set(
      `<Card>
<Form>
  <Checks name="scripts" :initial="['lint']" :options="[{value:'start'},{value:'test'},{value:'lint'}]" />
  <Input name="note" label="Комментарий" initial="без заметок" />
  <Slider name="port" label="Порт" :min="3000" :max="9000" :initial="4000" />
  <Tabs name="mode" :options="['server','window']" />
  <Row>
    <Button id="preset" :preset="{ scripts: ['start','test'], port: 8080, mode: 'window' }">Все</Button>
    <Button id="reset" reset>Сбросить</Button>
    <Button id="submit" submit summary="Настройки запуска">Применить</Button>
  </Row>
</Form>
</Card>`,
      false,
    );
    await wait('document.querySelector("#submit") !== null');
    const field = () =>
      browser.evaluate(`(() => {
        const q = (s) => document.querySelector(s);
        return JSON.stringify({
          scripts: [...document.querySelectorAll("input[type=checkbox]")].filter((i) => i.checked).map((i) => i.closest("label").innerText.trim()),
          note: q("input[type=text]").value,
          port: Number(q("input[type=range]").value),
          mode: q("[role=tab].on").textContent.trim(),
        });
      })()`);
    expect(JSON.parse(await field())).toEqual({
      scripts: ["lint"],
      note: "без заметок",
      port: 4000,
      mode: "server",
    });
    await browser.click("#preset");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(JSON.parse(await field())).toEqual({
      scripts: ["start", "test"],
      note: "без заметок",
      port: 8080,
      mode: "window",
    });
    await browser.click("#reset");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(JSON.parse(await field())).toEqual({
      scripts: ["lint"],
      note: "без заметок",
      port: 4000,
      mode: "server",
    });
    await browser.click("input[type=checkbox]");
    await browser.click("#submit");
    await wait('document.querySelector("#submit").textContent.includes("Отправлено")');
    const sent = await browser.evaluate("window.fixture.replies");
    expect(sent).toHaveLength(1);
    expect(sent[0].startsWith("Настройки запуска\n\n```json")).toBe(true);
    expect(JSON.parse(sent[0].split("```json\n")[1].split("\n```")[0])).toEqual({
      scripts: ["lint", "start"],
      note: "без заметок",
      port: 4000,
      mode: "server",
    });
    // After sending, the whole form is locked and a second click sends nothing.
    expect(await browser.evaluate('document.querySelectorAll("fieldset[disabled]").length')).toBe(
      1,
    );
    expect(await browser.evaluate('document.querySelector("#reset").disabled')).toBe(true);
    await browser.click("#submit");
    expect(await browser.evaluate("window.fixture.replies.length")).toBe(1);
    await browser.evaluate("window.fixture.replies.length = 0");

    // Stream in 40-character chunks; mark the first Card's DOM node once it is rendered.
    let marked = false;
    let mountsSeen = 0;
    for (let at = 40; at < message.length + 40; at += 40) {
      await set(message.slice(0, at), at < message.length);
      await new Promise((resolve) => setTimeout(resolve, 15));
      if (
        !marked &&
        (await browser.evaluate('Boolean(document.querySelector(".ui-card .stat"))'))
      ) {
        await browser.evaluate('document.querySelector(".ui-card").__mark = 1; true');
        marked = true;
      }
      if (marked)
        mountsSeen += (await browser.evaluate("document.querySelector('.ui-card').__mark === 1"))
          ? 0
          : 1;
    }
    expect(marked).toBe(true);
    expect(mountsSeen).toBe(0);
    await wait('document.querySelectorAll(".ui-card").length === 4');
    await wait('document.querySelectorAll(".steps li").length === 3');
    await wait('document.querySelector(".widget-pending") === null');
    expect(await browser.evaluate('document.querySelectorAll(".widget-failure").length')).toBe(0);
    await shot("widgets-1-initial");

    // Tabs switch the plotted series (state lives in the widget's script).
    const lineText = 'document.querySelector("figcaption").textContent.trim()';
    expect(await browser.evaluate(lineText)).toBe("Выручка");
    await browser.evaluate('[...document.querySelectorAll("[role=tab]")][1].click()');
    await wait(`${lineText} === "Расходы"`);

    // A slider recalculates the total; the button keeps its own state.
    const total = 'document.querySelector("#total").textContent';
    const before = await browser.evaluate(total);
    await browser.evaluate(`(() => {
      const range = document.querySelectorAll("input[type=range]")[0];
      range.value = 100000;
      range.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await wait(`${total} !== ${JSON.stringify(before)}`);
    await browser.evaluate(
      'document.querySelector("#count").click(); document.querySelector("#count").click()',
    );
    await wait('document.querySelector("#count").textContent.includes("2")');
    await shot("widgets-2-interacted");

    // More text after the widgets must not reset their state.
    await set(`${message}\n\nИ ещё абзац после.`, true);
    await wait('document.body.textContent.includes("ещё абзац")');
    expect(await browser.evaluate('document.querySelector("#count").textContent')).toContain("2");
    expect(await browser.evaluate('document.querySelector(".ui-card").__mark')).toBe(1);

    // A broken component reports an error instead of breaking the message.
    await set("До\n\n<Card><div></Card>\n\nПосле", false);
    await wait('document.querySelector(".widget-failure") !== null');
    expect(await browser.evaluate("document.body.textContent")).toContain("После");
    await shot("widgets-3-error");

    // A component answers the agent: the chosen options and a text become one chat message.
    await set(
      `<Card>
  <script>
    const picked = ref(["lint"]);
    const note = ref("");
    const sent = ref(false);
    function apply() { reply({ scripts: picked.value, note: note.value }, "Выбрано: " + picked.value.join(", ")); sent.value = true; }
    return { picked, note, sent, apply };
  </script>
  <Checks v-model="picked" :options="[{value:'start',hint:'dev-сервер'},{value:'test'},{value:'lint'}]" />
  <Input v-model="note" label="Комментарий" />
  <Button id="apply" :disabled="sent" @click="apply">{{ sent ? "Отправлено" : "Применить" }}</Button>
</Card>`,
      false,
    );
    await wait('document.querySelector("#apply") !== null');
    await browser.evaluate('[...document.querySelectorAll("input[type=checkbox]")][0].click()');
    await browser.evaluate(
      `(() => { const i = document.querySelector("input[type=text]"); i.value = "осторожно"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`,
    );
    await browser.click("#apply");
    await wait('document.querySelector("#apply").textContent.includes("Отправлено")');
    const replies = await browser.evaluate("window.fixture.replies");
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Выбрано: lint, start");
    expect(JSON.parse(replies[0].split("```json\n")[1].split("\n```")[0])).toEqual({
      scripts: ["lint", "start"],
      note: "осторожно",
    });

    // A name nobody defined is an error once the message is over, and not before: while streaming a
    // later `<script>` may still define it, and when it does the blank fills in.
    const body = "<Card>{{ late }}</Card>";
    await set(body, true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await browser.evaluate('document.querySelectorAll(".widget-failure").length')).toBe(0);
    await set(body, false);
    await wait('document.querySelector(".widget-failure") !== null');
    await set(`${body}\n\n<script>const late = ref("готово"); return { late };</script>`, false);
    await wait(
      'document.querySelector(".widget-failure") === null && document.body.textContent.includes("готово")',
    );

    // One shared script, several blocks: a slider in one drives a stat and a chart in others.
    const shared = `<Card><Slider label="Множитель" :min="1" :max="10" v-model="k" /></Card>

<Card><Stat id="out" label="Итого" :value="k * base" /></Card>

<Line :labels="['a','b']" :series="[{name:'s',data:[k, k * 2]}]" />

<script>
  const base = 100;
  const k = ref(2);
  return { base, k };
</script>`;
    await set(shared, true);
    await wait(
      'document.querySelector("#out") !== null && document.querySelector("#out").innerText.includes("200")',
    );
    expect(await browser.evaluate('document.querySelectorAll(".widget-failure").length')).toBe(0);
    await set(shared, false);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await browser.evaluate(
      `(() => { const r = document.querySelector(".slider input"); r.value = 7; r.dispatchEvent(new Event("input", { bubbles: true })); })()`,
    );
    await wait('document.querySelector("#out").innerText.includes("700")');
    expect(await browser.evaluate('document.querySelectorAll(".widget-failure").length')).toBe(0);
  },
);

const streamed = (script, tail) => `Отчёт:

<Card title="Сводка">
${script}
  <Row>
    <Stat label="Выручка" :value="total" />
    <Stat label="Заказы" value="76" />
  </Row>
  <Bars :items="[{label:'a',value:1},{label:'b',value:2}]" />
  <Line :labels="months" :series="[{name:'s',data:[1,2,3]}]" />
  <Tabs>
    <Tab title="Один"><Input name="x" /></Tab>
    <Tab title="Два">второй</Tab>
  </Tabs>
${tail}</Card>

Конец.`;
const SCRIPT = `  <script>
    window.__runs = (window.__runs ?? 0) + 1;
    const total = ref(1234);
    const months = ['a', 'b', 'c'];
    return { total, months };
  </script>`;

test(
  "a message grows in place: no remount, no errors, script once, inert until finished",
  { skip: !chromium, timeout: 120000, retry: 1 },
  async () => {
    const html = await readFile(new URL("./fixtures/agent-widgets.html", import.meta.url), "utf8");
    const fixture = await createBrowserFixture({ pages: { "/widgets": html } });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    await browser.open(fixture.url("/widgets"));
    await browser.viewport(900, 1200);
    const set = (value, live) =>
      browser.evaluate(`window.fixture.set(${JSON.stringify(value)}, ${live})`);
    const frame = () =>
      browser.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");

    // Script first, then the template; and script last (a late setup must fill the blanks in).
    for (const message of [streamed(SCRIPT, ""), streamed("", SCRIPT)]) {
      await set("", true);
      await browser.evaluate("window.__runs = 0; document.querySelector('.ui-card')?.remove?.()");
      let marked = false;
      let progressive = 0;
      let inertWhileStats = false;
      for (let at = 3; at < message.length + 3; at += 3) {
        await set(message.slice(0, at), at < message.length);
        await frame();
        const probe = JSON.parse(
          await browser.evaluate(`JSON.stringify({
            card: Boolean(document.querySelector(".ui-card")),
            marked: document.querySelector(".ui-card")?.__mark === 1,
            stat: document.querySelectorAll(".stat").length,
            statMarked: document.querySelector(".stat")?.__mark === 1,
            inert: Boolean(document.querySelector(".widget")?.hasAttribute("inert")),
            failures: document.querySelectorAll(".widget-failure").length,
          })`),
        );
        expect(probe.failures, `error at ${at}`).toBe(0);
        if (probe.card && !marked) {
          await browser.evaluate(
            'document.querySelector(".ui-card").__mark = 1; if (document.querySelector(".stat")) document.querySelector(".stat").__mark = 1; true',
          );
          marked = true;
          continue;
        }
        if (marked) {
          expect(probe.marked, `card remounted at ${at}`).toBe(true);
          if (probe.stat) {
            if (!probe.statMarked)
              await browser.evaluate('document.querySelector(".stat").__mark = 1; true');
            if (at < message.length) {
              progressive = Math.max(progressive, probe.stat);
              inertWhileStats ||= probe.inert;
            }
          }
        }
      }
      await frame();
      expect(marked).toBe(true);
      // Stats showed up before the message was finished, and the half-written widget was inert.
      expect(progressive).toBeGreaterThan(0);
      expect(inertWhileStats).toBe(true);
      expect(
        await browser.evaluate('document.querySelector(".widget").hasAttribute("inert")'),
      ).toBe(false);
      expect(await browser.evaluate("window.__runs")).toBe(1);
      expect(await browser.evaluate('document.querySelector(".stat").innerText')).toContain("1234");
      expect(await browser.evaluate('document.querySelectorAll(".widget-failure").length')).toBe(0);
      // The tabs and the form field made it into the finished widget.
      expect(await browser.evaluate('document.querySelectorAll("[role=tab]").length')).toBe(2);
      expect(await browser.evaluate('document.querySelectorAll(".bars li").length')).toBe(2);
    }
  },
);
