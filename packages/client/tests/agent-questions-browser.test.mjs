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
  import AgentQuestions from "/packages/client/modules/agent-turns/ui/AgentQuestions.vue";

  const request = {
    id: "q",
    title: "Questions",
    custom: true,
    questions: [
      {
        id: "0",
        header: "Проверка виджета",
        question: "Это тестовый вызов ask_user через tool calling. Виден ли виджет с вариантами ответа и полем своего варианта?",
        multiple: false,
        options: [
          { id: "0", label: "Виден", description: "Вопрос и варианты отрисовались в чате" },
          {
            id: "1",
            label: "Виден, но нужен другой вид",
            description: "Например, несколько вопросов или другой набор полей",
          },
          { id: "2", label: "Не виден", description: "Вместо виджета показался обычный текст" },
        ],
      },
    ],
  };
  const answers = [];
  const answer = (id, data) => answers.push({ id, data });
  const app = createApp({
    setup: () => () =>
      h("div", { style: "display: grid; gap: 16px; padding: 24px" }, [
        h("div", { class: "wide", style: "width: 680px" }, [
          h(AgentQuestions, { requests: [request], onAnswer: answer }),
        ]),
        h("div", { class: "narrow", style: "width: 360px" }, [
          h(AgentQuestions, { requests: [request], compact: true, onAnswer: answer }),
        ]),
      ]),
  });
  app.mount("#fixture");
  window.fixture = { ready: true, answers };
</script>`;

test.concurrent(
  "the ask-user widget stays compact and still sends the choice",
  { skip: !chromium, timeout: 90000, retry: 1 },
  async ({ onTestFinished }) => {
    const fixture = await createBrowserFixture({ pages: { "/questions": html } });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    await browser.open(fixture.url("/questions"));
    await browser.viewport(900, 1200);
    const wait = async (expression, ms = 8000) => {
      for (let waited = 0; waited < ms; waited += 50) {
        if (await browser.evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(await browser.evaluate(expression)).toBeTruthy();
    };

    await wait('document.querySelectorAll(".question").length === 2');

    // The widget is not another heavy card, and the narrow panel drops the descriptions.
    expect(await browser.evaluate('document.querySelectorAll(".question.ui-card").length')).toBe(0);
    expect(await browser.evaluate('document.querySelector(".wide .footer .own") !== null')).toBe(
      true,
    );
    expect(
      await browser.evaluate(`(() => {
        const own = document.querySelector(".wide .footer .own").getBoundingClientRect();
        const actions = document.querySelector(".wide .actions").getBoundingClientRect();
        return Math.abs(own.top - actions.top) < 6;
      })()`),
    ).toBe(true);
    expect(await browser.evaluate('document.querySelectorAll(".wide .description").length')).toBe(
      3,
    );
    expect(await browser.evaluate('document.querySelectorAll(".narrow .description").length')).toBe(
      0,
    );
    // The works panel starts folded: just the question and a chevron.
    expect(await browser.evaluate('document.querySelector(".narrow .options") === null')).toBe(
      true,
    );
    await browser.click(".narrow .fold");
    await wait('document.querySelector(".narrow .options") !== null');
    expect(await browser.evaluate('document.querySelectorAll(".narrow .description").length')).toBe(
      0,
    );
    expect(
      await browser.evaluate(
        'getComputedStyle(document.querySelector(".wide .own input")).borderTopWidth',
      ),
    ).toBe("0px");
    expect(
      await browser.evaluate(
        'document.querySelector(".wide .question").getBoundingClientRect().height',
      ),
    ).toBeLessThan(260);
    expect(
      await browser.evaluate(
        'document.querySelector(".narrow .question").getBoundingClientRect().height',
      ),
    ).toBeLessThan(240);

    // A chosen option survives folding: the body is hidden, the question stays.
    await browser.click(".wide .option");
    expect(await browser.evaluate('document.querySelectorAll(".wide .option.picked").length')).toBe(
      1,
    );
    await browser.click(".wide .fold");
    await wait(
      'document.querySelector(".wide .options") === null && document.querySelector(".wide .footer") === null',
    );
    expect(await browser.evaluate('document.querySelector(".wide .prompt") !== null')).toBe(true);
    await browser.click(".wide .fold");
    await wait('document.querySelector(".wide .option.picked") !== null');

    // A chosen option can be sent, and the answer reaches the parent of the widget.
    await browser.click(".wide .btn.solid");
    await wait("window.fixture.answers.length === 1");
    expect(await browser.evaluate("window.fixture.answers[0]")).toEqual({
      id: "q",
      data: { 0: ["0"] },
    });
  },
);
