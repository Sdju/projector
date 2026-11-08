import { expect, test } from "vite-plus/test";
import { readFile } from "node:fs/promises";
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

test.concurrent(
  "project widgets render their own data and disappear in another project",
  { skip: !chromium, timeout: 30000, retry: 1 },
  async ({ onTestFinished }) => {
    const html = await readFile(
      new URL("./fixtures/agent-project-widgets.html", import.meta.url),
      "utf8",
    );
    const widget = {
      name: "ModelMetrics",
      group: "project",
      summary: "метрики модели",
      props: { model: { type: "string", description: "имя модели", required: true } },
      data: { metrics: "metrics.json" },
      refresh: 5,
      script: `window.__projectScriptRuns = (window.__projectScriptRuns ?? 0) + 1;
const speed = computed(() => data.metrics.speed);
const title = computed(() => props.model + " / " + speed.value);
const clicks = ref(0);
return { speed, title, clicks };`,
      styles: ".value { color: rgb(1, 2, 3) }",
      template:
        '<Card :title="title"><Stat class="value" label="Скорость" :value="speed" /><Button id="bump" @click="clicks++">Нажато: {{ clicks }}</Button></Card>',
      example: '<ModelMetrics model="gpt-5" />',
    };
    const fixture = await createBrowserFixture({
      pages: { "/widgets": html },
      responses: [
        {
          startsWith: "/api/agent/project-widgets/data",
          type: "application/json",
          body: JSON.stringify({ data: { metrics: { speed: 42 } }, errors: {} }),
        },
        {
          startsWith: "/api/agent/project-widgets?projectId=p2",
          type: "application/json",
          body: JSON.stringify({
            projectId: "p2",
            path: "/p2",
            file: "/p2/.projector/widgets.json",
            exists: false,
            trusted: false,
            widgets: [],
          }),
        },
        {
          startsWith: "/api/agent/project-widgets?projectId=p",
          type: "application/json",
          body: JSON.stringify({
            projectId: "p",
            path: "/p",
            file: "/p/.projector/widgets.json",
            exists: true,
            trusted: true,
            widgets: [widget],
          }),
        },
      ],
    });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    await browser.open(fixture.url("/widgets"));
    await browser.viewport(700, 500);
    const wait = async (expression, ms = 8000) => {
      for (let waited = 0; waited < ms; waited += 50) {
        if (await browser.evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(await browser.evaluate(expression)).toBeTruthy();
    };

    await browser.evaluate('window.fixture.set(`<ModelMetrics model="gpt-5" />`, false)');
    await wait('document.querySelector(".project-widget .stat .value")?.textContent === "42"');
    expect(
      await browser.evaluate(
        'document.querySelector(".project-widget .ui-card .title").textContent',
      ),
    ).toBe("gpt-5 / 42");
    expect(await browser.evaluate("window.__projectScriptRuns")).toBe(1);
    expect(
      await browser.evaluate(
        'getComputedStyle(document.querySelector(".project-widget .value")).color',
      ),
    ).toBe("rgb(1, 2, 3)");
    await browser.click("#bump");
    await wait('document.querySelector("#bump").textContent.includes("1")');
    expect(await browser.evaluate("window.__projectScriptRuns")).toBe(1);

    await browser.evaluate('window.fixture.project("p2")');
    await wait('document.querySelector(".project-widget") === null');
    expect(await browser.evaluate("document.querySelector('.stat') === null")).toBe(true);
    expect(await browser.evaluate("window.__projectScriptRuns")).toBe(1);
  },
);

test.concurrent(
  "the composer owns the submit button of an IntelligentForm",
  { skip: !chromium, timeout: 30000, retry: 1 },
  async ({ onTestFinished }) => {
    const html = await readFile(
      new URL("./fixtures/agent-form-composer.html", import.meta.url),
      "utf8",
    );
    const fixture = await createBrowserFixture({ pages: { "/composer": html } });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    await browser.open(fixture.url("/composer"));
    await browser.viewport(600, 500);
    const wait = async (expression, ms = 8000) => {
      for (let waited = 0; waited < ms; waited += 50) {
        if (await browser.evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(await browser.evaluate(expression)).toBeTruthy();
    };

    await wait("window.fixture.submittable === true");
    expect(
      await browser.evaluate('document.querySelectorAll(".intelligent-form .btn").length'),
    ).toBe(0);
    await browser.click("#send");
    await wait("window.fixture.replies.length === 1");
    const [reply] = await browser.evaluate("window.fixture.replies");
    expect(reply.data).toEqual({ note: "ok" });
    expect(reply.summary).toBe("Composer form");
    expect(reply.text.startsWith("Composer form\n\n```json")).toBe(true);
  },
);

test.concurrent(
  "widgets stream without remounting, stay interactive and render charts",
  { skip: !chromium, timeout: 90000, retry: 1 },
  async ({ onTestFinished }) => {
    const html = await readFile(new URL("./fixtures/agent-widgets.html", import.meta.url), "utf8");
    const fixture = await createBrowserFixture({
      pages: { "/widgets": html },
      responses: [
        {
          startsWith: "/api/projects/p/workspace/external-asset",
          type: "image/svg+xml",
          body: "<svg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/>",
        },
      ],
    });
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
    // Click by index: several tab groups share the page, and `:nth-of-type` is ambiguous.
    await browser.evaluate("[...document.querySelectorAll('[role=tab]')][1].click()");
    await wait("[...document.querySelectorAll('[role=tabpanel]')][0].style.display === 'none'");
    await browser.evaluate("[...document.querySelectorAll('[role=tab]')][0].click()");
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

    // Data widgets: images, inline icons, chips and the on-demand GitInfo layout.
    await set(
      `<Card>
  <Chips :items="['TypeScript','Vue','Node.js']" mono />
  <Chips :items="[{label:'готово',tone:'success',icon:'circle-check'},{label:'риск',tone:'warning'}]" />
  <Image src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt="Пиксель" caption="Проверка" :height="120" />
  <Image src="/tmp/widget-shot.png" alt="Снимок с диска" :height="120" />
  <p><InlineIcon name="git-branch" label="Ветка" /> main <InlineIcon name="missing" /></p>
  <GitInfo branch="main" upstream="origin/main" :ahead="2" :staged="3" :unstaged="1" :untracked="2" :additions="48" :deletions="12" :commits="[{hash:'a1b2c3d4',subject:'Добавить GitInfo',author:'Ада',when:'2 ч назад'}]" :files="[{path:'core/modules/agent-widgets/git-info/index.ts',status:'A',additions:48,deletions:0}]" />
</Card>`,
      false,
    );
    await wait("document.querySelector('.git-info') !== null");
    expect(
      await browser.evaluate(
        "[...document.querySelectorAll('.chips')][0].querySelectorAll('.chip').length",
      ),
    ).toBe(3);
    expect(
      await browser.evaluate(
        "[...document.querySelectorAll('.chips')][0].querySelector('.chip').className",
      ),
    ).toContain("info");
    expect(
      await browser.evaluate(
        "[...document.querySelectorAll('.chips')][1].querySelector('.success svg') !== null",
      ),
    ).toBe(true);
    expect(
      await browser.evaluate(
        "[...document.querySelectorAll('.chips')][1].querySelector('.warning .dot') !== null",
      ),
    ).toBe(true);
    expect(
      await browser.evaluate("document.querySelector('.image img').getBoundingClientRect().height"),
    ).toBe(120);
    // A file on disk resolves like a markdown picture: the widget and the chat agree on the path.
    const imageSources = await browser.evaluate(
      "[...document.querySelectorAll('.image img')].map((image) => image.getAttribute('src'))",
    );
    expect(imageSources[0]).toContain("data:image/gif;base64,");
    expect(imageSources[1]).toBe(
      "/api/projects/p/workspace/external-asset?path=%2Ftmp%2Fwidget-shot.png",
    );
    // A click opens the same zoomable viewer as a markdown picture.
    await browser.evaluate("document.querySelectorAll('.image img')[1].click()");
    await wait('!!document.querySelector("dialog[open]")');
    expect(
      await browser.evaluate('document.querySelector("dialog[open] .modal-title").textContent'),
    ).toBe("Снимок с диска");
    expect(await browser.evaluate('!!document.querySelector("dialog[open] .view-controls")')).toBe(
      true,
    );
    await browser.click(".image-modal-close");
    await wait('!document.querySelector("dialog[open]")');
    expect(await browser.evaluate("document.querySelectorAll('.inline-icon svg').length")).toBe(1);
    expect(
      await browser.evaluate("document.querySelector('.inline-icon.missing').textContent"),
    ).toBe("•");
    const gitText = await browser.evaluate("document.querySelector('.git-info').innerText");
    expect(gitText).toContain("main");
    expect(gitText).toContain("origin/main");
    expect(gitText).toContain("+48");
    expect(gitText).toContain("a1b2c3d");
    expect(gitText).toContain("Добавить GitInfo");
    expect(gitText).toContain("core/modules/agent-widgets/git-info/index.ts");

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

    // The dedicated answer form brings its own submit button and sends its named fields.
    await set(
      `<IntelligentForm summary="Настройки" submit="Применить">
  <Input name="note" label="Комментарий" initial="без заметок" />
  <Checks name="scripts" :initial="['lint']" :options="['start','test','lint']" />
</IntelligentForm>`,
      false,
    );
    await wait('document.querySelector(".intelligent-form .btn") !== null');
    await browser.click(".intelligent-form .btn");
    await wait(
      'document.querySelector(".intelligent-form .btn").textContent.includes("Отправлено")',
    );
    const dedicated = await browser.evaluate("window.fixture.replies.at(-1)");
    expect(dedicated.startsWith("Настройки\n\n```json")).toBe(true);
    expect(JSON.parse(dedicated.split("```json\n")[1].split("\n```")[0])).toEqual({
      note: "без заметок",
      scripts: ["lint"],
    });
    expect(await browser.evaluate('document.querySelector(".intelligent-form").disabled')).toBe(
      true,
    );
    await browser.evaluate("window.fixture.replies.length = 0");

    // A promoted IntelligentForm lives only in the composer: the answer has no second copy or hint.
    const promoted = `<IntelligentForm summary="Настройки"><Input name="note" initial="x" /></IntelligentForm>`;
    await set(promoted, false);
    await browser.evaluate(`window.fixture.promote(${JSON.stringify(promoted)})`);
    await wait('document.querySelector(".intelligent-form") === null');
    expect(await browser.evaluate('document.querySelector(".promoted-form")')).toBe(null);

    // An answered form is represented by the user's snapshot: the answer hides its copy.
    const answeredForm = `<Form><Input name="note" initial="x" /></Form>`;
    await set(answeredForm, false);
    await browser.evaluate(`window.fixture.promote(${JSON.stringify(answeredForm)})`);
    await wait('document.querySelector(".promoted-form") !== null');
    expect(
      await browser.evaluate('document.querySelector(".promoted-form").textContent'),
    ).toContain("Форма доступна в поле ввода");
    await browser.evaluate("window.fixture.answer(true)");
    await wait(
      'document.querySelector(".promoted-form").textContent.includes("Ответ отправлен в форме")',
    );
    expect(await browser.evaluate('document.querySelector("fieldset.form")')).toBe(null);
    await browser.evaluate("window.fixture.answer(false)");
    await browser.evaluate("window.fixture.promote('')");

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

    // More text after the widgets must not reset their state.
    await set(`${message}\n\nИ ещё абзац после.`, true);
    await wait('document.body.textContent.includes("ещё абзац")');
    expect(await browser.evaluate('document.querySelector("#count").textContent')).toContain("2");
    expect(await browser.evaluate('document.querySelector(".ui-card").__mark')).toBe(1);

    // A broken component reports an error instead of breaking the message.
    await set("До\n\n<Card><div></Card>\n\nПосле", false);
    await wait('document.querySelector(".widget-failure") !== null');
    expect(await browser.evaluate("document.body.textContent")).toContain("После");

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

test.concurrent(
  "a message grows in place: no remount, no errors, script once, inert until finished",
  { skip: !chromium, timeout: 120000, retry: 1 },
  async ({ onTestFinished }) => {
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
      // Exercise incomplete tags, expressions and scripts at their boundaries.
      // Exhaustive prefix compilation is covered by the autoClose unit test.
      const cuts = new Set([message.length]);
      for (const match of message.matchAll(/<\/?[\w]+|[<>]|{{|}}|return/g)) {
        for (const at of [match.index + 1, match.index + match[0].length]) cuts.add(at);
      }
      const points = [...cuts].sort((a, b) => a - b);
      // Prefix compilation itself is covered by the autoClose unit test; streaming needs a
      // representative sample, and the complete message always closes the run.
      for (const [index, at] of points.entries()) {
        if (index % 3 !== 0 && at !== message.length) continue;
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

test.concurrent(
  "static SVG inside nested slots grows during streaming without losing its elements",
  { skip: !chromium, timeout: 60000, retry: 1 },
  async ({ onTestFinished }) => {
    const html = await readFile(new URL("./fixtures/agent-widgets.html", import.meta.url), "utf8");
    const fixture = await createBrowserFixture({ pages: { "/widgets": html } });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    await browser.open(fixture.url("/widgets"));
    const wait = async (expression) => {
      for (let i = 0; i < 100; i++) {
        if (await browser.evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(await browser.evaluate(expression)).toBeTruthy();
    };
    await wait("!!window.fixture?.ready");
    const head = '<Card title="Схема"><Columns><Card><svg viewBox="0 0 200 100" width="100%">';
    const defs = '<defs><marker id="arrow"><path d="M0 0 L10 5 L0 10 z" /></marker></defs>';
    const rect = '<rect x="10" y="10" width="80" height="50" fill="#6366f1" />';
    const text = '<text x="20" y="40">Команда</text>';
    const path = '<path d="M90 35 H180" stroke="#94a3b8" marker-end="url(#arrow)" />';
    for (const source of [head, head + defs, head + defs + rect, head + defs + rect + text]) {
      await browser.evaluate(`window.fixture.set(${JSON.stringify(source)}, true)`);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await wait("document.querySelector('.widget svg') !== null");
      if (source === head)
        await browser.evaluate("window.originalSvg = document.querySelector('.widget svg')");
    }
    const full = head + defs + rect + text + path + "</svg></Card></Columns></Card>";
    await browser.evaluate(`window.fixture.set(${JSON.stringify(full)}, false)`);
    await wait("document.querySelector('.widget svg rect') !== null");
    expect(
      await browser.evaluate("document.querySelector('.widget svg') === window.originalSvg"),
    ).toBe(true);
    expect(await browser.evaluate("document.querySelector('.widget svg text').textContent")).toBe(
      "Команда",
    );
    expect(await browser.evaluate("document.querySelectorAll('.widget svg path').length")).toBe(2);
    expect(await browser.evaluate("document.querySelector('.widget svg rect').namespaceURI")).toBe(
      "http://www.w3.org/2000/svg",
    );
    expect(
      await browser.evaluate("document.querySelector('.widget svg rect').getBBox().width"),
    ).toBe(80);
    expect(await browser.evaluate("document.querySelectorAll('.widget-failure').length")).toBe(0);
  },
);

test.concurrent(
  "line selects ranges directly and navigates the full minimap",
  { skip: !chromium, timeout: 60000, retry: 1 },
  async ({ onTestFinished }) => {
    const html = await readFile(new URL("./fixtures/agent-widgets.html", import.meta.url), "utf8");
    const fixture = await createBrowserFixture({ pages: { "/widgets": html } });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    await browser.open(fixture.url("/widgets"));
    await browser.viewport(900, 900);
    const labels = Array.from({ length: 101 }, (_, index) => String(index));
    const data = Array.from({ length: 101 }, (_, index) => index);
    const line = `<Line :labels='${JSON.stringify(labels)}' :series='[{"name":"s","data":${JSON.stringify(data)}}]' />`;
    await browser.evaluate(`window.fixture.set(${JSON.stringify(line)}, false)`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(
      await browser.evaluate(
        "[...document.querySelectorAll('.line .tool')].map((button) => button.textContent.trim())",
      ),
    ).toEqual(["Карта", "↺"]);

    await browser.click(".line .tool");
    const fullWidth = await browser.evaluate(
      "+document.querySelector('.mini-viewport').getAttribute('width')",
    );
    const center = await browser.evaluate(`(() => {
      const rect = document.querySelector('.line > svg').getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    for (let index = 0; index < 4; index++) {
      await browser.call("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        ...center,
        deltaX: 0,
        deltaY: -100,
      });
    }

    const miniClick = await browser.evaluate(`(() => {
      const svg = document.querySelector('.minimap');
      const rect = svg.getBoundingClientRect();
      const viewBoxX = svg.viewBox.baseVal.width * 0.7;
      const xs = svg.querySelector('polyline').getAttribute('points').split(' ')
        .map((point) => +point.split(',')[0]);
      const expectedCenter = xs.reduce((closest, x) =>
        Math.abs(x - viewBoxX) < Math.abs(closest - viewBoxX) ? x : closest
      );
      return {
        x: rect.x + rect.width * 0.7,
        y: rect.y + rect.height / 2,
        expectedCenter,
      };
    })()`);
    await browser.call("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      clickCount: 1,
      ...miniClick,
    });
    await browser.call("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      clickCount: 1,
      ...miniClick,
    });
    const miniCenter = await browser.evaluate(`(() => {
      const rect = document.querySelector('.mini-viewport');
      return +rect.getAttribute('x') + +rect.getAttribute('width') / 2;
    })()`);
    expect(Math.abs(miniCenter - miniClick.expectedCenter)).toBeLessThan(1);

    await browser.click(".line .tool:nth-child(2)");
    const brush = await browser.evaluate(`(() => {
      const rect = document.querySelector('.line > svg').getBoundingClientRect();
      const y = rect.y + rect.height / 2;
      return {
        start: { x: rect.x + rect.width * 0.25, y },
        end: { x: rect.x + rect.width * 0.7, y },
      };
    })()`);
    await browser.call("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      clickCount: 1,
      ...brush.start,
    });
    await browser.call("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      button: "left",
      buttons: 1,
      ...brush.end,
    });
    await browser.call("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      clickCount: 1,
      ...brush.end,
    });
    const selectedWidth = await browser.evaluate(
      "+document.querySelector('.mini-viewport').getAttribute('width')",
    );
    expect(selectedWidth).toBeGreaterThan(fullWidth * 0.35);
    expect(selectedWidth).toBeLessThan(fullWidth * 0.55);
    expect(await browser.evaluate("document.querySelectorAll('.widget-failure').length")).toBe(0);
  },
);

test.concurrent(
  "Answer Doctor replaces broken widget Markdown in the real chat",
  { skip: !chromium, timeout: 30000, retry: 1 },
  async ({ onTestFinished }) => {
    const html = await readFile(
      new URL("./fixtures/agent-answer-doctor.html", import.meta.url),
      "utf8",
    );
    const fixture = await createBrowserFixture({
      pages: { "/answer-doctor": html },
      responses: [
        {
          startsWith: "/api/agent/answer-repair",
          type: "application/json",
          body: JSON.stringify({
            answer:
              "<Card><h3>Контракт</h3><ul><li><strong>UI</strong>: <code>панель</code></li></ul></Card>",
          }),
        },
      ],
    });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    await browser.open(fixture.url("/answer-doctor"));
    await browser.viewport(760, 600);
    for (let waited = 0; waited < 8000; waited += 50) {
      if (await browser.evaluate('document.querySelector(".agent-message h3") !== null')) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(await browser.evaluate('document.querySelector(".agent-message h3").textContent')).toBe(
      "Контракт",
    );
    expect(
      await browser.evaluate('document.querySelector(".agent-message").textContent'),
    ).not.toContain("###");
    expect(
      await browser.evaluate('document.querySelector(".agent-message").textContent'),
    ).not.toContain("Лишний хвост");
    expect(
      await browser.evaluate('document.querySelector(".agent-message strong").textContent'),
    ).toBe("UI");
    expect(await browser.evaluate("window.fixture.persisted")).toBe(true);
  },
);
