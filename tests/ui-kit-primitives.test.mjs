import { test, expect } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { createBrowserFixture } from "./fixtures/browser-server.mjs";
import { chromium, createChromium } from "./fixtures/chromium-driver.mjs";

test(
  "UI kit retains native form, button and pointer lifecycle",
  { skip: !chromium, timeout: 45000 },
  async () => {
    const fixture = await createBrowserFixture({
      pages: {
        "/__ui_primitives": await readFile(
          new URL("./fixtures/ui-kit-primitives.html", import.meta.url),
          "utf8",
        ),
      },
    });
    let browser;
    try {
      browser = await createChromium(fixture.directory);
      await browser.viewport(800, 600);
      await browser.open(fixture.url("/__ui_primitives"));
      await browser.click("#save");
      expect(await browser.evaluate("window.fixture.state.submitted")).toBe(0);
      await browser.click("label");
      expect(await browser.evaluate("document.activeElement.name")).toBe("name");
      await browser.call("Input.insertText", { text: "Проект" });
      await browser.key("Enter");
      expect(await browser.evaluate("window.fixture.state.submitted")).toBe(1);
      await browser.click("#action");
      expect(
        await browser.evaluate("[window.fixture.state.clicked,window.fixture.state.submitted]"),
      ).toEqual([1, 1]);
      const width = await browser.evaluate(
        "document.querySelector('#save').getBoundingClientRect().width",
      );
      await browser.evaluate("window.fixture.state.busy=true;window.fixture.settle()");
      await browser.click("#save");
      expect(await browser.evaluate("window.fixture.state.submitted")).toBe(1);
      expect(
        await browser.evaluate(
          "document.querySelector('#save').disabled && document.querySelector('#save').getAttribute('aria-busy')==='true'",
        ),
      ).toBe(true);
      expect(
        await browser.evaluate("document.querySelector('#save').getBoundingClientRect().width"),
      ).toBe(width);
      await browser.evaluate("window.fixture.state.busy=false;window.fixture.settle()");
      await browser.click("#save");
      expect(await browser.evaluate("window.fixture.state.submitted")).toBe(2);
      await browser.viewport(390, 600);
      expect(await browser.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(
        true,
      );

      const pointer = (type, point, button = "left") =>
        browser.call("Input.dispatchMouseEvent", {
          type,
          ...point,
          button,
          clickCount: 1,
          ...(type === "mouseMoved" ? { buttons: 1 } : {}),
        });
      for (const finish of ["up", "cancel", "dispose"]) {
        await browser.evaluate(
          "document.body.style.cursor='crosshair';document.body.style.userSelect='text'",
        );
        const point = await browser.evaluate(
          "(()=>{const r=document.querySelector('#resize').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()",
        );
        const initial = await browser.evaluate("window.fixture.state.width");
        await pointer("mousePressed", point, "right");
        expect(await browser.evaluate("document.body.style.cursor")).toBe("crosshair");
        await pointer("mouseReleased", point, "right");
        await pointer("mousePressed", point);
        expect(
          await browser.evaluate(
            "document.querySelector('#resize').hasPointerCapture(window.lastPointer)",
          ),
        ).toBe(true);
        await browser.evaluate(
          "document.querySelector('#resize').dispatchEvent(new PointerEvent('pointermove',{pointerId:window.lastPointer+100,clientX:500}))",
        );
        expect(await browser.evaluate("window.fixture.state.width")).toBe(initial);
        const end = { ...point, x: point.x + 20 };
        await pointer("mouseMoved", end);
        expect(await browser.evaluate("window.fixture.state.width")).toBe(initial + 20);
        if (finish === "up") await pointer("mouseReleased", end);
        else if (finish === "cancel")
          await browser.evaluate(
            "document.querySelector('#resize').dispatchEvent(new PointerEvent('pointercancel',{pointerId:window.lastPointer}))",
          );
        else await browser.evaluate("window.fixture.state.visible=false;window.fixture.settle()");
        expect(
          await browser.evaluate("[document.body.style.cursor,document.body.style.userSelect]"),
        ).toEqual(["crosshair", "text"]);
        expect(await browser.evaluate("window.fixture.finishes.at(-1)")).toBe(finish);
        if (finish !== "up") await pointer("mouseReleased", end);
      }
      expect(browser.errors).toEqual([]);
    } finally {
      await browser?.close();
      await fixture.close();
    }
  },
);
