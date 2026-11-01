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
  const lens = {
    state: reactive({ open: false, text: "Собирает проект.", at: Date.now(), auto: true, busy: false, error: "" }),
    open: async () => "",
    close() {},
    toggle() {},
    setAuto() {},
    refresh: async () => "",
    clear() {},
    reset() {},
    stop() {},
  };
  const app = createApp({
    setup: () => () =>
      h("div", { style: "padding: 24px; max-width: 760px" }, [
        h(AgentTurn, {
          turn,
          busy: busy.value,
          last: true,
          copied: false,
          root: "/project",
          lens,
          onOpenFile: () => {},
        }),
      ]),
  });
  app.mount("#fixture");
  window.fixture = {
    ready: true,
    lens() {
      lens.state.open = true;
    },
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

test(
  "on a phone the work block opens as a bounded sheet that can always be closed",
  { skip: !chromium, timeout: 90000, retry: 1 },
  async () => {
    const fixture = await createBrowserFixture({ pages: { "/work": html } });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    await browser.open(fixture.url("/work"));
    await browser.viewport(390, 844);
    const wait = async (expression, ms = 8000) => {
      for (let waited = 0; waited < ms; waited += 50) {
        if (await browser.evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(await browser.evaluate(expression)).toBeTruthy();
    };

    await wait('document.querySelectorAll(".work").length === 2');
    await wait('document.querySelectorAll(".work[data-compact]").length === 2');
    expect(await browser.evaluate('document.querySelector(".island")')).toBeNull();

    // A tap on the summary opens the sheet instead of expanding the block inline.
    await browser.click(".work summary");
    await wait('document.querySelector(".island.mobile-sheet") !== null');
    expect(await browser.evaluate('document.querySelector(".work[open]")')).toBeNull();
    expect(await browser.evaluate('document.querySelectorAll(".work .work-body").length')).toBe(0);
    expect(await browser.evaluate('document.querySelectorAll(".island .activity").length')).toBe(1);
    expect(await browser.evaluate('document.querySelectorAll(".island .thought").length')).toBe(1);
    expect(
      await browser.evaluate('document.activeElement.classList.contains("work-sheet-title")'),
    ).toBe(true);
    expect(await browser.evaluate('document.querySelector(".work-scrim") !== null')).toBe(true);

    // The height is bounded by the viewport and nothing sticks out sideways.
    expect(
      await browser.evaluate(
        'document.querySelector(".island").getBoundingClientRect().height <= innerHeight * 0.72 + 1',
      ),
    ).toBe(true);
    expect(await browser.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);

    // Escape closes and returns focus to the summary.
    await browser.key("Escape");
    await wait('document.querySelector(".island") === null');
    expect(
      await browser.evaluate('document.activeElement.classList.contains("work-summary")'),
    ).toBe(true);

    // Lens is part of the header, without a card of its own: only the header/list divider remains.
    await browser.evaluate("window.fixture.lens()");
    await browser.click(".work:nth-of-type(2) summary");
    await wait('document.querySelector(".island") !== null');
    const header = await browser.evaluate(`(() => {
      const left = (selector) => Math.round(document.querySelector(selector).getBoundingClientRect().left);
      const lens = document.querySelector(".island .lens");
      return {
        title: left(".work-head-title"),
        lens: left(".island .lens .lens-head"),
        lensBorder: getComputedStyle(lens).borderTopWidth,
        headDivider: getComputedStyle(document.querySelector(".work-sheet-head")).borderBottomWidth,
        lensInSteps: Boolean(document.querySelector(".work-sheet-steps .lens")),
      };
    })()`);
    expect(header.title).toBe(header.lens);
    expect(header.lensBorder).toBe("0px");
    expect(header.headDivider).toBe("1px");
    expect(header.lensInSteps).toBe(false);
    await browser.key("Escape");
    await wait('document.querySelector(".island") === null');

    // The scrim catches a tap on the background: the sheet closes and nothing under it opens.
    await browser.click(".work summary");
    await wait('document.querySelector(".island") !== null');
    await browser.evaluate('document.querySelector(".work-scrim").click()');
    await wait('document.querySelector(".island") === null');

    // The header is an explicit way out even when the body is long.
    await browser.click(".work summary");
    await wait('document.querySelector(".island") !== null');
    await browser.click(".work-sheet-title");
    await wait('document.querySelector(".island") === null');

    // Back on a wide screen the block expands in place, as before.
    await browser.viewport(900, 1200);
    await wait('document.querySelectorAll(".work[data-compact]").length === 0');
    await wait('document.querySelector(".island") === null');
    await browser.click(".work:nth-of-type(2) summary");
    await wait('document.querySelector(".work[open] .work-body") !== null');
    expect(await browser.evaluate('document.querySelectorAll(".island").length')).toBe(0);
    const desktop = await browser.evaluate(`(() => {
      const lens = document.querySelector(".work-head .lens");
      const body = document.querySelector(".work-body");
      return {
        lensInHeader: Boolean(lens),
        lensInSteps: Boolean(body?.querySelector(".lens")),
        lensBorder: lens ? getComputedStyle(lens).borderTopWidth : null,
        divider: getComputedStyle(body).borderTopWidth,
        bodyBorderLeft: getComputedStyle(body).borderLeftWidth,
      };
    })()`);
    expect(desktop.lensInHeader).toBe(true);
    expect(desktop.lensInSteps).toBe(false);
    expect(desktop.lensBorder).toBe("0px");
    expect(desktop.divider).toBe("1px");
    expect(desktop.bodyBorderLeft).toBe("0px");
  },
);
