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
    await browser.evaluate('document.querySelector("#apply").click()');
    await wait('document.querySelector("#apply").textContent.includes("Отправлено")');
    const replies = await browser.evaluate("window.fixture.replies");
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("Выбрано: lint, start");
    expect(JSON.parse(replies[0].split("```json\n")[1].split("\n```")[0])).toEqual({
      scripts: ["lint", "start"],
      note: "осторожно",
    });

    // A script that arrives after the component (late chunk) fixes the earlier render error.
    const body = "<Card>{{ late }}</Card>";
    await set(body, true);
    await wait('document.querySelector(".widget-failure") !== null');
    await set(`${body}\n\n<script>const late = ref("готово"); return { late };</script>`, true);
    await wait(
      'document.querySelector(".widget-failure") === null && document.body.textContent.includes("готово")',
    );
  },
);
