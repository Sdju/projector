import { expect, onTestFinished, test } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import { createBrowserFixture } from "./fixtures/browser-server.mjs";
import { chromium, createChromium } from "./fixtures/chromium-driver.mjs";

test(
  "queued clarification shows delivery and enters the running answer at the next boundary",
  { skip: !chromium },
  async () => {
    const html = await readFile(new URL("./fixtures/agent-queue.html", import.meta.url), "utf8");
    const fixture = await createBrowserFixture({ pages: { "/queue": html } });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    await browser.open(fixture.url("/queue"));
    await browser.evaluate(`document.querySelector("input").focus()`);
    await browser.call("Input.insertText", { text: "Учти новую задачу" });
    await browser.click("button");
    expect(await browser.evaluate('document.querySelector(".label").textContent')).toBe(
      "Передаётся агенту",
    );
    expect(
      await browser.evaluate('document.querySelector(".queue button:last-of-type").disabled'),
    ).toBe(true);
    await browser.click("main > button:last-of-type");
    await browser.evaluate("new Promise(resolve => requestAnimationFrame(resolve))");
    expect(await browser.evaluate('document.querySelectorAll(".queue li").length')).toBe(0);
    expect(await browser.evaluate('document.querySelector("output").textContent')).toBe(
      "Учти новую задачу",
    );
    expect(await browser.evaluate("window.fixture.state.busy")).toBe(true);
    expect(
      await browser.evaluate("JSON.parse(JSON.stringify(window.fixture.state.turns[0].parts))"),
    ).toEqual([{ type: "note", text: "Учти новую задачу" }]);
    expect(browser.errors).toEqual([]);
  },
);
