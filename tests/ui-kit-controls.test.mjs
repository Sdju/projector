import { expect, test } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { createBrowserFixture } from "./fixtures/browser-server.mjs";
import { chromium, createChromium } from "./fixtures/chromium-driver.mjs";
test(
  "UiControl retains Vue native model, modifiers, events and form semantics",
  { skip: !chromium, timeout: 45000 },
  async () => {
    const fixture = await createBrowserFixture({
      pages: {
        "/__ui_controls": await readFile(
          new URL("./fixtures/ui-kit-controls.html", import.meta.url),
          "utf8",
        ),
      },
    });
    let browser;
    try {
      browser = await createChromium(fixture.directory);
      await browser.viewport(1200, 1800);
      await browser.open(fixture.url("/__ui_controls"));
      expect(await browser.evaluate("document.querySelector('form').checkValidity()")).toBe(false);
      await browser.click("input[name=text]");
      await browser.call("Input.imeSetComposition", {
        text: "你好",
        selectionStart: 2,
        selectionEnd: 2,
      });
      expect(await browser.evaluate("window.fixture.model.text")).toBe("");
      await browser.call("Input.insertText", { text: "你好" });
      expect(await browser.evaluate("window.fixture.model.text")).toBe("你好");
      expect(await browser.evaluate("window.fixture.actions")).toContainEqual([
        "input",
        "INPUT",
        "你好",
      ]);
      expect(await browser.evaluate("window.fixture.actions.map(a=>a[0])")).toContain(
        "compositionstart",
      );
      expect(await browser.evaluate("window.fixture.actions.map(a=>a[0])")).toContain(
        "compositionend",
      );
      await browser.click("input[name=lazy]");
      await browser.call("Input.insertText", { text: "Отложенное значение" });
      expect(await browser.evaluate("window.fixture.model.lazy")).toBe("");
      await browser.key("Tab");
      expect(await browser.evaluate("window.fixture.model.lazy")).toBe("Отложенное значение");
      await browser.click("input[name=trim]");
      await browser.call("Input.insertText", { text: "  текст  " });
      await browser.key("Tab");
      expect(
        await browser.evaluate(
          "[window.fixture.model.trim,document.querySelector('input[name=trim]').value]",
        ),
      ).toEqual(["текст", "текст"]);
      await browser.evaluate("document.querySelector('input[name=number]').select()");
      await browser.call("Input.insertText", { text: "42" });
      expect(await browser.evaluate("window.fixture.model.number")).toBe(42);
      await browser.click("textarea");
      await browser.call("Input.insertText", { text: "Первая строка\nВторая строка" });
      expect(await browser.evaluate("window.fixture.model.memo")).toBe(
        "Первая строка\nВторая строка",
      );
      await browser.click("input[name=checked]");
      await browser.click("input[name=choices][value=two]");
      await browser.click("input[name=radio][value=b]");
      expect(
        await browser.evaluate(
          "[window.fixture.model.checked,[...window.fixture.model.choices],window.fixture.model.radio]",
        ),
      ).toEqual([true, ["two"], "b"]);
      await browser.evaluate("window.fixture.model.choices.push('one');window.fixture.settle()");
      expect(
        await browser.evaluate("document.querySelector('input[name=choices][value=one]').checked"),
      ).toBe(true);
      await browser.evaluate(
        "(() => { const el=document.querySelector('select[name=single]');el.selectedIndex=1;el.dispatchEvent(new Event('change',{bubbles:true})); })()",
      );
      expect(await browser.evaluate("window.fixture.model.single.id")).toBe(2);
      await browser.evaluate(
        "(() => { const el=document.querySelector('select[name=multiple]');el.options[1].selected=true;el.dispatchEvent(new Event('change',{bubbles:true})); })()",
      );
      expect(await browser.evaluate("window.fixture.model.multiple.map(v=>v.id)")).toEqual([1, 2]);
      await browser.evaluate("window.fixture.model.multiple.splice(0,1);window.fixture.settle()");
      expect(
        await browser.evaluate(
          "[...document.querySelector('select[name=multiple]').options].map(option=>option.selected)",
        ),
      ).toEqual([false, true]);
      await browser.evaluate(
        "window.fixture.setExternal('Обновлённое значение');window.fixture.settle()",
      );
      expect(await browser.evaluate("document.querySelector('input[name=external]').value")).toBe(
        "Обновлённое значение",
      );
      expect(
        await browser.evaluate(
          "document.querySelector('input[name=disabled]').matches(':disabled')",
        ),
      ).toBe(true);
      await browser.click("button[type=submit]");
      expect(
        await browser.evaluate("window.fixture.actions.find(a=>a[0]==='submit')[1].text"),
      ).toBe("你好");
      expect(
        await browser.evaluate("window.fixture.actions.find(a=>a[0]==='submit')[1].memo"),
      ).toBe("Первая строка\nВторая строка");
      expect(browser.errors).toEqual([]);
    } finally {
      await browser?.close();
      await fixture.close();
    }
  },
);

test(
  "UiControl supports native value/checked without a model and exposes the same input",
  { skip: !chromium, timeout: 45000 },
  async () => {
    const fixture = await createBrowserFixture({
      pages: {
        "/__ui_controls": await readFile(
          new URL("./fixtures/ui-kit-controls.html", import.meta.url),
          "utf8",
        ),
      },
    });
    let browser;
    try {
      browser = await createChromium(fixture.directory);
      await browser.viewport(1200, 1500);
      await browser.open(fixture.url("/__ui_controls"));
      const state = (kind) =>
        browser.evaluate(
          `([...document.querySelectorAll('[data-kind=${kind}] input,[data-kind=${kind}] textarea,[data-kind=${kind}] select')].map(el=>({type:el.type,value:el.value,checked:el.checked ?? null})))`,
        );
      expect(await state("kit")).toEqual(await state("native"));
      for (const kind of ["native", "kit"]) {
        await browser.click(`input[name=${kind}-free-text]`);
        await browser.key("End");
        await browser.call("Input.insertText", { text: " ввод" });
        await browser.click(`input[name=${kind}-free-check]`);
        await browser.click(`select[name=${kind}-free-select]`);
        await browser.key("Home");
        await browser.key("Enter");
      }
      await browser.evaluate("window.fixture.free.tick++;window.fixture.settle()");
      expect(await state("kit")).toEqual(await state("native"));
      await browser.evaluate(
        "window.fixture.refs['kit-memo'].focus();window.fixture.refs['kit-memo'].select()",
      );
      expect(
        await browser.evaluate(
          "[document.activeElement.name,document.activeElement.selectionStart,document.activeElement.selectionEnd]",
        ),
      ).toEqual(["kit-free-memo", 0, 15]);
      await browser.evaluate(
        "window.fixture.refs['kit-select'].select();window.fixture.refs['kit-select'].focus()",
      );
      expect(await browser.evaluate("document.activeElement.name")).toBe("kit-free-select");
      expect(
        await browser.evaluate(
          "window.fixture.actions.filter(a=>a[0].includes('unexpected-model'))",
        ),
      ).toEqual([]);
      expect(
        await browser.evaluate(
          "window.fixture.actions.filter(a=>a[0].includes('free-change')).map(a=>a[1])",
        ),
      ).toEqual([false, false]);
      await browser.evaluate(
        "window.fixture.free.checked=false;window.fixture.free.value='Внешнее';window.fixture.settle()",
      );
      expect(await state("kit")).toEqual(await state("native"));
      expect(
        await browser.evaluate(
          "window.fixture.refs.kit.element===document.querySelector('input[name=kit-free-text]')",
        ),
      ).toBe(true);
      await browser.evaluate(
        "window.fixture.refs.kit.focus({preventScroll:true});window.fixture.refs.kit.select()",
      );
      expect(
        await browser.evaluate(
          "[document.activeElement.name,document.activeElement.selectionStart,document.activeElement.selectionEnd]",
        ),
      ).toEqual(["kit-free-text", 0, 7]);
      await browser.call("Input.insertText", { text: "Замена" });
      expect(
        await browser.evaluate("document.querySelector('input[name=kit-free-text]').value"),
      ).toBe("Замена");
      await browser.evaluate(
        "window.dynamicElement=document.querySelector('input[name=dynamic]');window.dynamicElement.focus();window.fixture.free.checked=true;window.fixture.free.controlled=true;window.fixture.settle()",
      );
      expect(
        await browser.evaluate(
          "document.activeElement===window.dynamicElement && window.dynamicElement===document.querySelector('input[name=dynamic]')",
        ),
      ).toBe(true);
      await browser.click("input[name=dynamic]");
      expect(await browser.evaluate("window.fixture.free.checked")).toBe(false);
      await browser.evaluate("window.fixture.free.controlled=false;window.fixture.settle()");
      await browser.click("input[name=dynamic]");
      expect(
        await browser.evaluate(
          "[window.fixture.free.checked,document.querySelector('input[name=dynamic]').checked]",
        ),
      ).toEqual([false, true]);
      expect(browser.errors).toEqual([]);
    } finally {
      await browser?.close();
      await fixture.close();
    }
  },
);
