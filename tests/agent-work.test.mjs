import { expect, onTestFinished, test } from "vite-plus/test";
import { createBrowserFixture } from "./fixtures/browser-server.mjs";
import { chromium, createChromium } from "./fixtures/chromium-driver.mjs";

const html = `<!doctype html>
<link rel="icon" href="data:," />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<div id="fixture"></div>
<script type="module">
  import "/src/app/styles.css";
  import { createApp, h, reactive, ref } from "vue";
  import AgentTurn from "/src/modules/agent/ui/AgentTurn.vue";

  const startedAt = Date.now() - 4200;
  const finishedAt = Date.now() - 1000;
  const text = "До работы.\\n\\nПосле работы.";
  const turn = reactive({
    id: "turn-work",
    role: "assistant",
    text,
    at: Date.now(),
    tools: [
      {
        id: "call-1",
        name: "bash",
        status: "running",
        input: JSON.stringify({ command: "vp test" }),
        detail: "",
        startedAt,
      },
      {
        id: "call-2",
        name: "Read",
        status: "done",
        input: JSON.stringify({ file_path: "src/a.ts" }),
        detail: "ok",
        startedAt,
        endedAt: finishedAt,
      },
    ],
    parts: [
      { type: "tool", id: "call-1" },
      { type: "thought", text: "Проверяю тесты." },
      { type: "text", text },
      { type: "tool", id: "call-2" },
    ],
  });
  const busy = ref(true);
  const app = createApp({
    setup: () => () =>
      h("div", { style: "padding: 24px; max-width: 760px" }, [
        h(AgentTurn, {
          turn,
          busy: busy.value,
          last: true,
          copied: false,
          root: "/project",
          onOpenFile: () => {},
        }),
      ]),
  });
  app.mount("#fixture");
  window.fixture = {
    ready: true,
    finish() {
      turn.tools[0].status = "done";
      turn.tools[0].endedAt = Date.now();
      busy.value = false;
    },
  };
</script>`;

test(
  "work groups collect thoughts and calls, stay closed and mount their body lazily",
  { skip: !chromium, timeout: 90000, retry: 1 },
  async () => {
    const fixture = await createBrowserFixture({ pages: { "/work": html } });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    await browser.open(fixture.url("/work"));
    await browser.viewport(900, 1200);
    const wait = async (expression, ms = 8000) => {
      for (let waited = 0; waited < ms; waited += 50) {
        if (await browser.evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(await browser.evaluate(expression)).toBeTruthy();
    };

    // Two work groups around one text: thoughts and calls never render outside a group.
    await wait('document.querySelectorAll(".work").length === 2');
    expect(
      await browser.evaluate('[...document.querySelectorAll(".work")].map((item) => item.open)'),
    ).toEqual([false, false]);
    expect(await browser.evaluate('document.querySelectorAll(".work .activity").length')).toBe(0);
    expect(await browser.evaluate('document.querySelectorAll(".work .thought").length')).toBe(0);
    expect(
      await browser.evaluate(
        '[...document.querySelectorAll(".work")].map((item) => item.querySelector(".work-step")?.textContent.trim() ?? "")',
      ),
    ).toEqual(["Команда vp test", ""]);

    const collapsed = await browser.evaluate('document.querySelectorAll("#fixture *").length');

    // Opening one group mounts its body only: first its calls, then the thought that followed.
    await browser.click(".work summary");
    await wait(
      'document.querySelectorAll(".work")[0].open === true && document.querySelector(".work .work-body") !== null',
    );
    expect(await browser.evaluate('document.querySelectorAll(".work .activity").length')).toBe(1);
    expect(await browser.evaluate('document.querySelectorAll(".work .thought").length')).toBe(1);
    expect(
      await browser.evaluate('document.querySelector(".work .thought .thought-text").textContent'),
    ).toContain("Проверяю тесты.");
    expect(
      await browser.evaluate(`(() => {
        const body = document.querySelector(".work .work-body");
        return [...body.children].map((element) =>
          element.classList.contains("activity") ? "activity" : "thought",
        );
      })()`),
    ).toEqual(["activity", "thought"]);
    const opened = await browser.evaluate('document.querySelectorAll("#fixture *").length');
    expect(opened).toBeGreaterThan(collapsed + 10);

    // Closing takes the body out of the DOM again.
    await browser.click(".work summary");
    await wait(
      'document.querySelectorAll(".work")[0].open === false && document.querySelector(".work .work-body") === null',
    );
    expect(await browser.evaluate('document.querySelectorAll(".work .activity").length')).toBe(0);
    expect(await browser.evaluate('document.querySelectorAll(".work .thought").length')).toBe(0);

    // The groups keep their place around the answer text, which is rendered exactly once.
    expect(
      await browser.evaluate(`(() => {
        const body = document.querySelector(".assistant-body");
        return [...body.children].map((element) =>
          element.classList.contains("work")
            ? "work"
            : element.classList.contains("agent-message")
              ? "text"
              : element.tagName.toLowerCase(),
        );
      })()`),
    ).toEqual(["work", "text", "work"]);
    expect(
      await browser.evaluate('document.querySelectorAll(".assistant-body .agent-message").length'),
    ).toBe(1);
    expect(
      await browser.evaluate(
        'document.querySelector(".assistant-body .agent-message").textContent',
      ),
    ).toContain("До работы.");
    expect(
      await browser.evaluate(
        'document.querySelector(".assistant-body .agent-message").textContent',
      ),
    ).toContain("После работы.");

    // Everything is finished: the header is just "Работа", with no current step.
    await browser.evaluate("window.fixture.finish()");
    await wait(
      '[...document.querySelectorAll(".work")].every((item) => item.querySelector(".work-step") === null)',
    );
    expect(
      await browser.evaluate(
        '[...document.querySelectorAll(".work")].map((item) => item.querySelector("summary").textContent.trim())',
      ),
    ).toEqual(["Работа", "Работа"]);
  },
);
