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
  import AgentTrajectoryTab from "/packages/client/modules/agent-trajectory/ui/AgentTrajectoryTab.vue";
  import AgentTrajectoryAside from "/packages/client/modules/agent-trajectory/ui/AgentTrajectoryAside.vue";
  import TrajectoryDocumentView from "/packages/client/modules/agent-trajectory/ui/TrajectoryDocumentView.vue";
  import { putTrajectoryDocument } from "/packages/client/modules/agent-trajectory/model/store.ts";

  const document = {
    format: "projector.trajectory",
    version: 1,
    title: "Разбор падения",
    subtitle: "файл траектории",
    data: {
      records: [
        { id: "u", kind: "user", turn: 1, title: "Почему упал тест?", text: "Почему упал тест?" },
        { id: "a", kind: "assistant", turn: 1, title: "Ответ", text: "Причина в ожидании." },
        {
          id: "t",
          kind: "tool",
          turn: 1,
          title: "Команда",
          text: "FAIL tests/core",
          status: "error",
          durationMs: 3500,
        },
      ],
    },
  };
  const saved = putTrajectoryDocument(document);
  const app = createApp({
    setup: () => () =>
      h("div", { style: "display:grid; grid-template-columns: minmax(0, 1fr) 360px; gap:16px; padding:16px; height:900px; box-sizing:border-box" }, [
        h("div", { style: "min-width:0; height:540px" }, [
          h("h2", { style: "font-size:14px; margin:0 0 8px" }, "Tab"),
          h(AgentTrajectoryTab, { id: saved.id, onTitle: () => {} }),
        ]),
        h("div", { style: "height:540px" }, [
          h("h2", { style: "font-size:14px; margin:0 0 8px" }, "Panel"),
          h(AgentTrajectoryAside),
        ]),
        h("div", { style: "grid-column:1/-1; height:300px" }, [
          h("h2", { style: "font-size:14px; margin:0 0 8px" }, "Document"),
          h(TrajectoryDocumentView, {
            content: JSON.stringify(document),
            path: "incident.trajectory.json",
          }),
        ]),
      ]),
  });
  app.mount("#fixture");
  window.fixture = { ready: true, id: saved.id };
</script>`;

const emptyHtml = `<!doctype html>
<link rel="icon" href="data:," />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<div id="fixture"></div>
<script type="module">
  import "/packages/client/app/styles.css";
  import { createApp, h } from "vue";
  import AgentTrajectoryAside from "/packages/client/modules/agent-trajectory/ui/AgentTrajectoryAside.vue";
  createApp({ setup: () => () => h("div", { style: "width:320px; height:480px" }, h(AgentTrajectoryAside)) }).mount("#fixture");
  window.fixture = { ready: true };
</script>`;

test.concurrent(
  "the same document fills a tab, the right panel and a .trajectory.json viewer",
  { skip: !chromium, timeout: 90000, retry: 1 },
  async ({ onTestFinished }) => {
    const fixture = await createBrowserFixture({ pages: { "/surfaces": html } });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    await browser.open(fixture.url("/surfaces"));
    await browser.viewport(1200, 1000);
    const wait = async (expression, ms = 8000) => {
      for (let waited = 0; waited < ms; waited += 50) {
        if (await browser.evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(await browser.evaluate(expression)).toBeTruthy();
    };

    await wait('document.querySelectorAll(".panel").length === 3');
    expect(
      await browser.evaluate(
        '[...document.querySelectorAll(".panel h2")].map((item) => item.textContent.trim())',
      ),
    ).toEqual(["Разбор падения", "Разбор падения", "Разбор падения"]);
    expect(
      await browser.evaluate(
        '[...document.querySelectorAll(".panel .kind")].map((item) => item.textContent.trim())',
      ),
    ).toEqual(["вы", "агент", "вызов", "вы", "агент", "вызов", "вы", "агент", "вызов"]);
    expect(
      await browser.evaluate('document.querySelectorAll(".panel .record.selected").length'),
    ).toBe(0);
    // The file view remembered the document, so the panel shows it too.
    expect(await browser.evaluate("window.fixture.id.length > 0")).toBe(true);
    expect(browser.errors).toEqual([]);
  },
);

test.concurrent(
  "the empty panel stays readable in a narrow rail",
  { skip: !chromium, timeout: 90000, retry: 1 },
  async ({ onTestFinished }) => {
    const fixture = await createBrowserFixture({ pages: { "/empty": emptyHtml } });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    await browser.open(fixture.url("/empty"));
    await browser.viewport(360, 600);

    expect(await browser.evaluate('document.querySelector(".empty-state") !== null')).toBe(true);
    expect(await browser.evaluate('document.body.textContent.includes("ide.trajectory")')).toBe(
      false,
    );
    expect(
      await browser.evaluate('getComputedStyle(document.querySelector(".empty-state p")).display'),
    ).toBe("block");
    expect(
      await browser.evaluate(
        'document.querySelector(".empty-state p").getBoundingClientRect().width',
      ),
    ).toBeLessThanOrEqual(260);
    expect(browser.errors).toEqual([]);
  },
);
