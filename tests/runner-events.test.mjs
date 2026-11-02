import { afterEach, expect, test, vi } from "vite-plus/test";

afterEach(() => {
  delete globalThis[Symbol.for("projector.page-events")];
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

test.each(["shared", "legacy", "fallback"])(
  "%s transport delivers each chunk once after runner module reloads",
  async (mode) => {
    vi.useFakeTimers();
    vi.stubGlobal("location", { search: mode === "legacy" ? "?eventsTransport=legacy" : "" });
    vi.stubGlobal("addEventListener", vi.fn());
    const sources = [];
    const workers = [];
    vi.stubGlobal(
      "EventSource",
      class extends EventTarget {
        constructor() {
          super();
          sources.push(this);
        }
      },
    );
    vi.stubGlobal(
      "SharedWorker",
      class {
        port = { start: vi.fn(), close: vi.fn(), postMessage: vi.fn(), onmessage: null };
        constructor() {
          workers.push(this);
        }
      },
    );
    const oldHandler = vi.fn();
    const { connectEvents } = await import("../src/modules/runner/lib/events.ts");
    connectEvents("page", oldHandler);
    if (mode === "shared") workers[0].port.onmessage({ data: { type: "ready" } });
    if (mode === "fallback") await vi.advanceTimersByTimeAsync(8000);

    const chunks = [];
    const handler = (_name, data) => chunks.push(JSON.parse(data).text);
    // Re-evaluate the module, just as HMR does while an answer is streaming.
    for (let i = 0; i < 4; i++) {
      vi.resetModules();
      const reloaded = await import("../src/modules/runner/lib/events.ts");
      reloaded.connectEvents("page", handler);
    }
    for (const text of ["Ре", "ализовал", " раздел"]) {
      const data = JSON.stringify({ text });
      for (const worker of workers)
        worker.port.onmessage({ data: { type: "event", name: "agent", data } });
      for (const source of sources) {
        const event = new Event("agent");
        Object.assign(event, { data });
        source.dispatchEvent(event);
      }
    }
    expect(chunks.join("")).toBe("Реализовал раздел");
    expect(oldHandler).not.toHaveBeenCalled();
    expect(workers).toHaveLength(mode === "legacy" ? 0 : 1);
    expect(sources).toHaveLength(mode === "shared" ? 0 : 1);
  },
);
