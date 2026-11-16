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
  import AgentPermissions from "/packages/client/modules/agent-turns/ui/AgentPermissions.vue";

  const permission = {
    id: "p",
    tool: "bash",
    title: "Выполнить команду в оболочке",
    detail: "rm -f /tmp/projector-judge-smoke",
    persistent: true,
    judge: {
      score: 3,
      label: "умеренный",
      reason: "Удаление временного файла вне проекта",
      confidence: "high",
      effect: "Удалит файл /tmp/projector-judge-smoke, если он существует",
    },
  };
  const decisions = [];
  const decide = (id, allow, always) => decisions.push({ id, allow, always });
  const app = createApp({
    setup: () => () =>
      h("div", { style: "padding: 24px; width: 680px" }, [
        h(AgentPermissions, { permissions: [permission], onDecide: decide }),
      ]),
  });
  app.mount("#fixture");
  window.fixture = { ready: true, decisions };
</script>`;

test.concurrent(
  "the permission card keeps the shield score and answers with icon buttons",
  { skip: !chromium, timeout: 90000, retry: 1 },
  async ({ onTestFinished }) => {
    const fixture = await createBrowserFixture({ pages: { "/permission": html } });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    await browser.open(fixture.url("/permission"));
    await browser.viewport(900, 1200);
    const wait = async (expression, ms = 8000) => {
      for (let waited = 0; waited < ms; waited += 50) {
        if (await browser.evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(await browser.evaluate(expression)).toBeTruthy();
    };

    await wait('document.querySelector(".permission") !== null');
    expect(
      await browser.evaluate('document.querySelector(".permission").classList.contains("risk-3")'),
    ).toBe(true);
    expect(await browser.evaluate('document.querySelector(".risk-box") === null')).toBe(true);
    expect(await browser.evaluate('document.querySelector(".risk .risk-score").textContent')).toBe(
      "3/5",
    );
    expect(await browser.evaluate('document.querySelector(".risk svg") !== null')).toBe(true);
    expect(
      await browser.evaluate(
        'document.querySelector(".permission").getBoundingClientRect().height',
      ),
    ).toBeLessThan(260);
    expect(await browser.evaluate('document.querySelectorAll(".actions .btn").length')).toBe(3);
    expect(
      await browser.evaluate(
        '[...document.querySelectorAll(".actions .btn")].every((button) => !button.textContent.trim())',
      ),
    ).toBe(true);

    await browser.click('button[title="Разрешить"]');
    await browser.click('button[title="Отклонить"]');
    await browser.click('button[title="Разрешить и больше не спрашивать про этот инструмент"]');
    expect(await browser.evaluate("window.fixture.decisions")).toEqual([
      { id: "p", allow: true },
      { id: "p", allow: false },
      { id: "p", allow: true, always: true },
    ]);
  },
);
