import { expect, onTestFinished, test } from "vite-plus/test";
import { createBrowserFixture } from "./fixtures/browser-server.mjs";
import { chromium, createChromium } from "./fixtures/chromium-driver.mjs";

const html = `<!doctype html>
<link rel="icon" href="data:," />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<div id="fixture" style="padding: 24px; max-width: 760px"></div>
<script type="module">
  import "/src/app/styles.css";
  import { createApp, h, ref } from "vue";
  import AgentMessage from "/src/modules/agent/ui/AgentMessage.vue";
  import { chatProjectKey } from "/src/modules/chat-images/index.ts";
  const text = ref("");
  const app = createApp({
    setup: () => () => h(AgentMessage, { text: text.value, streaming: false }),
  });
  app.provide(chatProjectKey, "p");
  app.mount("#fixture");
  window.fixture = {
    ready: true,
    set(value) {
      text.value = value;
    },
  };
</script>`;

test(
  "markdown images in a chat answer load safely and open in the modal viewer",
  { skip: !chromium, timeout: 90000, retry: 1 },
  async () => {
    const fixture = await createBrowserFixture({
      pages: { "/images": html },
      responses: [
        {
          startsWith: "/api/projects/p/workspace/external-asset",
          type: "image/svg+xml",
          body: "<svg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/>",
        },
      ],
    });
    onTestFinished(() => fixture.close());
    const browser = await createChromium(fixture.directory);
    onTestFinished(() => browser.close());
    await browser.open(fixture.url("/images"));
    await browser.viewport(900, 1200);
    const wait = async (expression, ms = 8000) => {
      for (let waited = 0; waited < ms; waited += 50) {
        if (await browser.evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(await browser.evaluate(expression)).toBeTruthy();
    };
    await wait("!!window.fixture?.ready");

    await browser.evaluate(
      `window.fixture.set(${JSON.stringify(`![Пиксель](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)

![Скрин](/tmp/shot.png)

![Засекречено](../secret.png)

![Письмо](mailto:someone@example.com)

![Опасное](javascript:alert(1))`)})`,
    );
    await wait('document.querySelectorAll(".md img").length === 2');

    const images =
      await browser.evaluate(`(() => [...document.querySelectorAll(".md img")].map((image) => ({
      alt: image.getAttribute("alt"),
      src: image.getAttribute("src"),
      loading: image.getAttribute("loading"),
      decoding: image.getAttribute("decoding"),
      referrerpolicy: image.getAttribute("referrerpolicy"),
      className: image.getAttribute("class"),
    })))()`);
    expect(images.map((image) => image.alt)).toEqual(["Пиксель", "Скрин"]);
    expect(images[0].src).toContain("data:image/gif;base64,");
    expect(images[1].src).toBe("/api/projects/p/workspace/external-asset?path=%2Ftmp%2Fshot.png");
    for (const image of images) {
      expect(image.loading).toBe("lazy");
      expect(image.decoding).toBe("async");
      expect(image.referrerpolicy).toBe("no-referrer");
      expect(image.className).toBe("md-image");
    }

    // A local path that is not inside the project and a mailto: source degrade to their alt text.
    expect(
      await browser.evaluate(
        '[...document.querySelectorAll(".md-image-text")].map((item) => item.textContent)',
      ),
    ).toEqual(["Засекречено", "Письмо"]);
    // javascript: never becomes an image.
    expect(
      await browser.evaluate(
        '[...document.querySelectorAll(".md img")].some((image) => image.src.startsWith("javascript:"))',
      ),
    ).toBe(false);
    expect(await browser.evaluate("document.body.textContent")).toContain("Опасное");

    // A click on the picture opens the modal viewer with a transparent canvas, not a new tab.
    await browser.evaluate('document.querySelectorAll(".md img")[1].click()');
    await wait('!!document.querySelector("dialog[open]")');

    const viewer = await browser.evaluate(`(() => {
      const dialog = document.querySelector("dialog[open]");
      const canvas = dialog.querySelector(".image-canvas");
      const image = canvas.querySelector("img");
      const select = dialog.querySelector(".view-controls select");
      return {
        canvasClass: canvas.className,
        background: getComputedStyle(canvas).backgroundColor,
        src: image.src,
        alt: image.alt,
        title: dialog.querySelector(".modal-title").textContent,
        backgroundValue: select.value,
        options: [...select.options].map((option) => option.textContent),
        hasClose: !!dialog.querySelector(".image-modal-close"),
      };
    })()`);
    const target = new URL(viewer.src);
    expect(target.pathname).toBe("/api/projects/p/workspace/external-asset");
    expect(target.searchParams.get("path")).toBe("/tmp/shot.png");
    expect(viewer.alt).toBe("Скрин");
    expect(viewer.title).toBe("Скрин");
    expect(viewer.canvasClass).toContain("transparent");
    expect(viewer.background).toBe("rgba(0, 0, 0, 0)");
    expect(viewer.backgroundValue).toBe("transparent");
    expect(viewer.options).toContain("Прозрачный");
    expect(viewer.hasClose).toBe(true);

    // The close button removes the viewer.
    await browser.click(".image-modal-close");
    await wait('!document.querySelector("dialog[open]")');

    // Escape closes the native dialog too.
    await browser.evaluate('document.querySelectorAll(".md img")[1].click()');
    await wait('!!document.querySelector("dialog[open]")');
    await browser.key("Escape");
    await wait('!document.querySelector("dialog[open]")');

    // A click on the backdrop — the dialog element itself outside the frame — closes it.
    await browser.evaluate('document.querySelectorAll(".md img")[1].click()');
    await wait('!!document.querySelector("dialog[open]")');
    await browser.evaluate('document.querySelector("dialog[open]").click()');
    await wait('!document.querySelector("dialog[open]")');

    // On a phone the viewer takes the whole screen instead of a small floating panel.
    await browser.viewport(390, 844);
    await browser.evaluate('document.querySelectorAll(".md img")[1].click()');
    await wait('!!document.querySelector("dialog[open]")');
    const phone = await browser.evaluate(`(() => {
      const dialog = document.querySelector("dialog[open]");
      const rect = dialog.getBoundingClientRect();
      const controls = dialog.querySelector(".view-controls");
      const header = dialog.querySelector(".modal-head");
      return {
        width: rect.width,
        height: rect.height,
        top: rect.top,
        left: rect.left,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        radius: getComputedStyle(dialog).borderRadius,
        border: getComputedStyle(dialog).borderTopWidth,
        overflow: dialog.scrollWidth - innerWidth,
        controlsOverflow: controls.scrollWidth - controls.clientWidth,
        headerTop: header.getBoundingClientRect().top,
        close: !!dialog.querySelector(".image-modal-close"),
      };
    })()`);
    expect(phone.width).toBe(phone.viewportWidth);
    expect(phone.height).toBe(phone.viewportHeight);
    expect(phone.top).toBe(0);
    expect(phone.left).toBe(0);
    expect(phone.radius).toBe("0px");
    expect(phone.border).toBe("0px");
    expect(phone.overflow).toBeLessThanOrEqual(0);
    expect(phone.controlsOverflow).toBeLessThanOrEqual(0);
    expect(phone.headerTop).toBe(0);
    expect(phone.close).toBe(true);
    await browser.key("Escape");
    await wait('!document.querySelector("dialog[open]")');

    // A phone in landscape is short but wide: the viewer still uses the whole screen.
    await browser.viewport(844, 390);
    await browser.evaluate('document.querySelectorAll(".md img")[1].click()');
    await wait('!!document.querySelector("dialog[open]")');
    const landscape = await browser.evaluate(`(() => {
      const dialog = document.querySelector("dialog[open]");
      const rect = dialog.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        overflow: dialog.scrollWidth - innerWidth,
      };
    })()`);
    expect(landscape.width).toBe(landscape.viewportWidth);
    expect(landscape.height).toBe(landscape.viewportHeight);
    expect(landscape.overflow).toBeLessThanOrEqual(0);
    await browser.key("Escape");
    await wait('!document.querySelector("dialog[open]")');
  },
);
