import { expect, test } from "vite-plus/test";
import { createBrowserFixture } from "../../../tests/fixtures/browser-server.mjs";
import { chromium, createChromium } from "../../../tests/fixtures/chromium-driver.mjs";

const html = `<!doctype html>
<link rel="icon" href="data:," />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<div id="fixture"></div>
<script type="module">
  import "/packages/client/app/styles.css";
  import { createApp, h } from "vue";
  import AgentTrajectoryPanel from "/packages/client/modules/agent-trajectory/ui/AgentTrajectoryPanel.vue";
  import { trajectoryFromTurns } from "/packages/client/modules/agent-trajectory/model/trajectory.ts";

  const turns = [
    {
      id: "u1",
      role: "user",
      text: "Проверь сборку",
      at: Date.now() - 20_000,
      tools: [],
    },
    {
      id: "a1",
      role: "assistant",
      text: "Сначала посмотрю.",
      at: Date.now() - 18_000,
      tools: [
        {
          id: "t1",
          name: "bash",
          status: "done",
          input: JSON.stringify({ command: "vp test" }),
          detail: "ok",
          startedAt: Date.now() - 17_000,
          endedAt: Date.now() - 15_000,
        },
      ],
      parts: [
        { type: "thought", text: "Надо запустить тесты." },
        { type: "tool", id: "t1" },
        { type: "text", text: "Сначала посмотрю." },
      ],
      usage: { input: 100, output: 20, cacheRead: 50, cacheWrite: 0, cost: 0.01 },
      context: { used: 1000, size: 8000, model: "deepseek" },
    },
  ];
  const data = trajectoryFromTurns(turns);
  const selected = [];
  const app = createApp({
    setup: () => () =>
      h("div", { style: "display:flex; height:720px; width:1000px" }, [
        h(AgentTrajectoryPanel, {
          data,
          "onUpdate:selected": (id) => selected.push(id),
        }),
      ]),
  });
  app.mount("#fixture");
  window.fixture = { ready: true, selected, data };
</script>`;

test.concurrent(
  "the trajectory panel works from current chat turns and inspects a call",
  { skip: !chromium, timeout: 90000, retry: 1 },
  async ({ onTestFinished }) => {
    const fixture = await createBrowserFixture({ pages: { "/trajectory": html } });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    await browser.open(fixture.url("/trajectory"));
    await browser.viewport(1100, 900);
    const wait = async (expression, ms = 8000) => {
      for (let waited = 0; waited < ms; waited += 50) {
        if (await browser.evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(await browser.evaluate(expression)).toBeTruthy();
    };

    await wait('document.querySelector(".panel .record") !== null');
    expect(await browser.evaluate('document.querySelectorAll(".panel .span").length')).toBe(4);
    expect(
      await browser.evaluate(
        '[...document.querySelectorAll(".panel .kind")].map((item) => item.textContent.trim()).slice(0, 4)',
      ),
    ).toEqual(["вы", "мысль", "вызов", "агент"]);

    // The tool row opens the shared tool inspector, not a reduced copy of it.
    await browser.click('.panel [data-record-id="tool:t1"]');
    await wait('document.querySelector(".panel .inspector") !== null');
    expect(
      await browser.evaluate('document.querySelector(".panel .inspector .tool") !== null'),
    ).toBe(true);
    expect(
      await browser.evaluate('document.querySelector(".panel .inspector").textContent'),
    ).not.toContain("t1");
    expect(
      await browser.evaluate('document.querySelector(".panel .inspector .raw") === null'),
    ).toBe(true);
    expect(
      await browser.evaluate('document.querySelectorAll(".panel .record.selected").length'),
    ).toBe(1);
    expect(await browser.evaluate("window.fixture.selected.length")).toBe(1);

    // A turn folds its rows and keeps its header.
    const before = await browser.evaluate('document.querySelectorAll(".panel .record").length');
    await browser.click(".panel .turn");
    await wait('document.querySelector(".panel .turn")?.getAttribute("aria-expanded") === "false"');
    expect(
      await browser.evaluate('document.querySelectorAll(".panel .record").length'),
    ).toBeLessThan(before);

    // Recorded tool times switch the overview from equal widths to relative widths.
    expect(
      await browser.evaluate('document.querySelectorAll(".panel .scale button")[1].disabled'),
    ).toBe(false);
    await browser.click(".panel .scale button:nth-child(2)");
    expect(
      await browser.evaluate(
        'document.querySelectorAll(".panel .scale button")[1].getAttribute("aria-pressed")',
      ),
    ).toBe("true");

    // The panel reports what it cannot show yet instead of leaving a silent gap.
    expect(await browser.evaluate('document.body.textContent.includes("TTFT")')).toBe(true);
  },
);
