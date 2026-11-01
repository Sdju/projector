import { readFile, writeFile } from "node:fs/promises";
import { createBrowserFixture } from "../../tests/fixtures/browser-server.mjs";
import { chromium, createChromium } from "../../tests/fixtures/chromium-driver.mjs";

/**
 * Chat rendering benchmark: real AgentTurn/AgentMessage components, real Chromium, Vite dev build.
 * Run from the repository root: `node scripts/bench-chat/run.mjs`.
 *
 * The numbers are relative: they compare chat sizes, message sizes and streaming costs on one
 * machine. The Vue runtime here is the development build, so absolute values are above production.
 */

if (!chromium) {
  console.error("Chromium не найден: задайте CHROMIUM_BIN или установите /usr/bin/chromium");
  process.exit(1);
}

const html = await readFile(new URL("./page.html", import.meta.url), "utf8");
const fixture = await createBrowserFixture({ pages: { "/bench": html } });
const browser = await createChromium(fixture.directory);
const results = { meta: {}, scenarios: [] };

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))];
}

function summarize(values) {
  const numbers = values.filter((value) => Number.isFinite(value) && value >= 0);
  return {
    n: numbers.length,
    p50: percentile(numbers, 0.5),
    p95: percentile(numbers, 0.95),
    max: numbers.length ? Math.max(...numbers) : 0,
    mean: numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : 0,
  };
}

const round = (value, digits = 1) => Number(value.toFixed(digits));
const rounded = (stats) =>
  Object.fromEntries(
    Object.entries(stats).map(([key, value]) => [key, key === "n" ? value : round(value)]),
  );

async function call(name, config, repeats) {
  return browser.evaluate(
    `window.fixture[${JSON.stringify(name)}](${JSON.stringify(config)}${
      repeats === undefined ? "" : `, ${repeats}`
    })`,
  );
}

function mountSummary(runs) {
  return {
    patch: rounded(summarize(runs.map((run) => run.patch))),
    layout: rounded(summarize(runs.map((run) => run.layout))),
    total: rounded(summarize(runs.map((run) => run.total))),
    nodes: runs[0]?.nodes ?? 0,
    mounted: runs[0]?.mounted,
    height: runs[0]?.height ?? 0,
    openMs: runs[0]?.openMs === undefined ? undefined : round(runs[0].openMs),
    opened: runs[0]?.opened,
    openNodes: runs[0]?.openNodes,
  };
}

function streamSummary(result) {
  return {
    chunks: result.chunks,
    chars: result.chars,
    deferred: result.deferred,
    stalled: result.stalled,
    deferredPercent: round((result.deferred / Math.max(1, result.chunks)) * 100),
    wallMs: round(result.wall),
    patch: rounded(summarize(result.updates.map((update) => update.patch))),
    latency: rounded(summarize(result.updates.map((update) => update.latency))),
    perChunk: {
      patch: rounded(summarize(result.updates.map((update) => update.patch))),
      latency: rounded(summarize(result.updates.map((update) => update.latency))),
    },
    frames: {
      ...rounded(summarize(result.frames)),
      over33: result.frames.filter((delta) => delta > 33).length,
      over50: result.frames.filter((delta) => delta > 50).length,
    },
    longTasks: {
      count: result.longTasks.length,
      total: round(result.longTasks.reduce((sum, value) => sum + value, 0)),
      max: round(Math.max(0, ...result.longTasks)),
    },
    nodes: result.nodes,
    openMs: result.openMs === undefined ? undefined : round(result.openMs),
    opened: result.opened,
    openNodes: result.openNodes,
  };
}

function record(id, title, config, data) {
  results.scenarios.push({ id, title, config, data });
  const brief =
    data.total?.p50 !== undefined
      ? `patch ${data.patch?.p50} ms, layout ${data.layout?.p50} ms, nodes ${data.nodes}`
      : data.wallMs !== undefined
        ? `wall ${data.wallMs} ms, update p50 ${data.patch.p50} ms, chunk p95 ${data.latency.p95} ms`
        : JSON.stringify(data).slice(0, 160);
  console.log(`ok ${id} ${JSON.stringify(config)} · ${brief}`);
}

try {
  await browser.viewport(1400, 1000);
  await browser.open(fixture.url("/bench"));
  const info = await call("info");
  results.meta = {
    date: new Date().toISOString(),
    userAgent: info.ua,
    viewport: "1400x1000 (chat log 900x900, conversation 680px)",
    build: "Vite dev server, Vue development build",
    chromium,
  };
  console.log(`# ${info.ua}`);

  // Warm up Vite transforms and every lazy path that runs once.
  await call("mountList", { requests: 5, chars: 1200 }, 1);
  await call("mountWindowed", { requests: 5, chars: 1200 }, 1);
  await call("streamMessage", { chars: 2000, chunk: 256, streaming: false }, 1);

  // 1. Cold mount of a chat: cost of showing N requests at once.
  for (const requests of [5, 10, 25, 50, 100, 250]) {
    const runs = await call("mountList", { requests, chars: 1200, kind: "prose" }, 3);
    record(
      "mount-chat",
      `Открытие чата: ${requests} запросов по 1.2 КБ`,
      { requests, chars: 1200 },
      mountSummary(runs),
    );
  }

  // 2. Cold mount of one answer of a growing size.
  for (const chars of [2000, 16000, 64000, 256000]) {
    const runs = await call("mountList", { requests: 1, chars, kind: "prose" }, 3);
    record(
      "mount-prose",
      `Открытие ответа: ${chars / 1000} КБ текста`,
      { chars },
      mountSummary(runs),
    );
  }
  for (const chars of [2000, 8000, 32000, 128000]) {
    const runs = await call("mountList", { requests: 1, chars, kind: "code" }, 3);
    record("mount-code", `Открытие ответа: код ${chars / 1000} КБ`, { chars }, mountSummary(runs));
  }
  for (const chars of [16000, 64000]) {
    const runs = await call("mountList", { requests: 1, chars, kind: "table" }, 3);
    record(
      "mount-table",
      `Открытие ответа: таблица ${chars / 1000} КБ`,
      { chars },
      mountSummary(runs),
    );
  }
  for (const widgets of [2, 8, 24]) {
    const runs = await call("mountList", { requests: 1, chars: 1000, widgets }, 3);
    record(
      "mount-widgets",
      `Открытие ответа: ${widgets} виджетов`,
      { widgets },
      mountSummary(runs),
    );
  }
  for (const tools of [50, 200]) {
    const runs = await call("mountList", { requests: 1, chars: 1000, tools }, 3);
    record(
      "mount-tools",
      `Открытие ответа: ${tools} вызовов, «Работа» закрыта`,
      { tools },
      mountSummary(runs),
    );
  }
  {
    const runs = await call(
      "mountList",
      { requests: 1, chars: 1000, tools: 200, openWork: true },
      2,
    );
    record(
      "mount-tools-open",
      "Открытие ответа: 200 вызовов, «Работа» раскрыта",
      { tools: 200 },
      mountSummary(runs),
    );
  }
  for (const thoughts of [20, 100]) {
    const runs = await call("mountList", { requests: 1, chars: 600, thoughts }, 3);
    record(
      "mount-thoughts",
      `Открытие ответа: ${thoughts} рассуждений, «Работа» закрыта`,
      { thoughts },
      mountSummary(runs),
    );
  }
  {
    const runs = await call(
      "mountList",
      { requests: 1, chars: 600, thoughts: 100, openWork: true },
      2,
    );
    record(
      "mount-thoughts-open",
      "Открытие ответа: 100 рассуждений, «Работа» раскрыта",
      { thoughts: 100 },
      mountSummary(runs),
    );
  }

  // 3. Opening a long chat through the real window (last five requests only).
  for (const requests of [10, 100, 1000, 10000]) {
    const runs = await call("mountWindowed", { requests, chars: 1200, kind: "prose" }, 2);
    record(
      "open-windowed",
      `Открытие длинного чата: ${requests} запросов`,
      { requests },
      mountSummary(runs),
    );
  }

  // 4. Appending one request to a chat that is already on screen.
  for (const requests of [10, 50, 200, 500]) {
    const runs = await call("append", { requests, chars: 4000, kind: "prose" }, 3);
    record(
      "append-full",
      `Добавление запроса в чат из ${requests}`,
      { requests },
      mountSummary(runs),
    );
  }
  for (const requests of [10, 1000, 10000]) {
    const runs = await call("append", { requests, chars: 4000, kind: "prose", window: true }, 2);
    record(
      "append-windowed",
      `Добавление запроса в окно при ${requests} в чате`,
      { requests },
      mountSummary(runs),
    );
  }

  // 5. Streaming an answer while the chat holds N mounted requests.
  for (const requests of [10, 50, 200]) {
    const result = await call("streamInTurn", {
      requests,
      chars: 8000,
      chunk: 128,
      kind: "prose",
    });
    record(
      "stream-chat",
      `Поток в чате из ${requests} запросов`,
      { requests },
      streamSummary(result),
    );
  }
  for (const requests of [10, 1000, 10000]) {
    const result = await call("streamInTurn", {
      requests,
      chars: 8000,
      chunk: 128,
      kind: "prose",
      window: true,
    });
    record(
      "stream-windowed",
      `Поток в окне при ${requests} в чате`,
      { requests },
      streamSummary(result),
    );
  }
  for (const openWork of [false, true]) {
    const result = await call("streamInTurn", {
      requests: 10,
      chars: 8000,
      chunk: 128,
      kind: "prose",
      window: true,
      streamTools: 200,
      openWork,
    });
    record(
      openWork ? "stream-work-open" : "stream-work",
      `Поток ответа с 200 вызовами, «Работа» ${openWork ? "раскрыта" : "закрыта"}`,
      { streamTools: 200, openWork },
      streamSummary(result),
    );
  }

  // 6. Streaming cost against the size of one message, without the render throttle.
  for (const chars of [2000, 8000, 32000, 96000]) {
    const result = await call("streamMessage", {
      chars,
      chunk: 256,
      kind: "prose",
      streaming: false,
    });
    record(
      "stream-prose",
      `Поток текста ${chars / 1000} КБ, без троттлинга`,
      { chars, chunk: 256 },
      streamSummary(result),
    );
  }
  for (const chars of [2000, 8000, 32000, 96000]) {
    const result = await call("streamMessage", {
      chars,
      chunk: 256,
      kind: "code",
      streaming: false,
    });
    record(
      "stream-code",
      `Поток кода ${chars / 1000} КБ, без троттлинга`,
      { chars, chunk: 256 },
      streamSummary(result),
    );
  }

  // 7. The same stream through the real throttle, chunk by chunk as tokens arrive.
  for (const [kind, chars] of [
    ["prose", 32000],
    ["code", 24000],
  ]) {
    const result = await call("streamMessage", { chars, chunk: 64, kind, streaming: true });
    record(
      "stream-real",
      `Реальный поток: ${kind} ${chars / 1000} КБ по 64 символа`,
      { chars, kind, chunk: 64 },
      streamSummary(result),
    );
  }

  // 7b. The same paced stream inside the chat, pinned to the bottom as AgentChat does.
  for (const [kind, chars] of [
    ["prose", 32000],
    ["code", 24000],
  ]) {
    const result = await call("streamInTurn", {
      requests: 10,
      chars,
      chunk: 64,
      kind,
      window: true,
      pin: true,
    });
    record(
      "stream-pinned",
      `Поток с прокруткой вниз: ${kind} ${chars / 1000} КБ`,
      { chars, kind },
      streamSummary(result),
    );
  }

  // 8. Scrolling a long mounted chat.
  for (const requests of [25, 100, 250]) {
    const result = await call("scroll", { requests, chars: 1200, kind: "prose" });
    record(
      "scroll",
      `Прокрутка чата из ${requests} запросов`,
      { requests },
      {
        step: rounded(summarize(result.steps)),
        frame: {
          ...rounded(summarize(result.frames)),
          over33: result.frames.filter((delta) => delta > 33).length,
          over50: result.frames.filter((delta) => delta > 50).length,
        },
        height: result.height,
        nodes: result.nodes,
      },
    );
  }

  // 9. Switching from one chat to another.
  for (const requests of [10, 50, 250]) {
    const runs = await call("switchChat", { requests, chars: 1200, kind: "prose" }, 2);
    record(
      "switch-full",
      `Переключение чата: ${requests} запросов`,
      { requests },
      mountSummary(runs),
    );
  }
  const windowRuns = await call(
    "switchChat",
    { requests: 1000, chars: 1200, kind: "prose", window: true },
    2,
  );
  record(
    "switch-windowed",
    "Переключение чата: 1000 запросов через окно",
    { requests: 1000 },
    mountSummary(windowRuns),
  );

  // 10. Heap after a chat is mounted: a baseline and the growth by chat size.
  await browser.call("HeapProfiler.enable");
  const heap = [];
  for (const requests of [0, 5, 50, 250, 500]) {
    const mounted = await call("mountPersist", { requests, chars: 1200, kind: "prose" });
    await browser.call("HeapProfiler.collectGarbage");
    const usage = await browser.call("Runtime.getHeapUsage");
    heap.push({
      requests,
      usedMb: round(usage.usedSize / 1048576),
      nodes: mounted.nodes,
      height: mounted.height,
    });
    console.log(`ok heap ${requests} ${heap.at(-1).usedMb} МБ`);
  }
  results.scenarios.push({
    id: "heap",
    title: "Память renderer после GC",
    config: {},
    data: heap,
  });

  await call("clear");
  results.meta.errors = browser.errors.slice(0, 5);
} catch (cause) {
  results.meta.failed = cause instanceof Error ? cause.message : String(cause);
  results.meta.errors = browser.errors.slice(0, 5);
  throw cause;
} finally {
  const output = process.env.BENCH_OUT ?? "/tmp/opencode/chat-bench.json";
  await writeFile(output, JSON.stringify(results, null, 2));
  console.log(`\nJSON: ${output}`);
  await browser.close();
  await fixture.close();
}
