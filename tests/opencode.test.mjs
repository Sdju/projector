import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { os } from "../core/modules/os/index.ts";
import { readGoUsage } from "../server/modules/agents-integration/opencode/client.ts";
import { goWindows, openCodeUsage } from "../server/modules/agents-integration/opencode/usage.ts";
import { handleOpenCode } from "../server/routes/api/opencode.ts";
import { resetCountdown } from "../src/common/utilities/reset-time.ts";

const window = { status: "ok", percent: 42, resetsAt: "2026-10-10T12:00:00Z" };
const payload = { usage: { rolling: window, weekly: window, monthly: window } };

test("compact reset countdown handles missing, expired and minute/hour/day boundaries", () => {
  const now = 1791150000000;
  const reset = (seconds) => resetCountdown(now / 1000 + seconds, now);
  for (const value of [null, undefined, NaN, Infinity])
    assert.equal(resetCountdown(value, now), "—");
  assert.equal(reset(-10), "сейчас");
  assert.equal(reset(0), "сейчас");
  assert.equal(reset(59), "<1м");
  assert.equal(reset(60), "1м");
  assert.equal(reset(3599), "59м");
  assert.equal(reset(3600), "1ч");
  assert.equal(reset(8100), "2ч 15м");
  assert.equal(reset(86400), "1д");
  assert.equal(reset(187200), "2д 4ч");
});

test("Go windows validate percentages and status, normalize resets and exhausted limits", () => {
  const parsed = goWindows(payload);
  assert.equal(parsed.weekly.usedPercent, 42);
  assert.equal(parsed.weekly.resetsAt, Date.parse(window.resetsAt) / 1000);
  assert.equal(parsed.weekly.limited, false);
  assert.equal(
    goWindows({
      usage: { ...payload.usage, rolling: { ...window, status: "rate-limited", percent: 99 } },
    }).rolling.usedPercent,
    100,
  );
  assert.equal(
    goWindows({ usage: { ...payload.usage, weekly: { ...window, resetsAt: "invalid" } } }).weekly
      .resetsAt,
    null,
  );
  for (const percent of [-1, 101, NaN, Infinity, "42", null])
    assert.equal(goWindows({ usage: { ...payload.usage, weekly: { ...window, percent } } }), null);
  for (const value of [
    null,
    {},
    { usage: [] },
    { usage: { weekly: window } },
    { usage: { ...payload.usage, monthly: { ...window, status: "unknown" } } },
  ])
    assert.equal(goWindows(value), null);
});

test("Go reads existing auth, bounds and sanitizes requests, shares cached API results", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "projector-opencode-"));
  const previousFetch = globalThis.fetch;
  const previousEnv = {
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    OPENCODE_AUTH_CONTENT: process.env.OPENCODE_AUTH_CONTENT,
  };
  const state = globalThis.projectorOpenCodeUsage;
  let calls = 0;
  process.env.XDG_DATA_HOME = directory;
  delete process.env.OPENCODE_AUTH_CONTENT;
  await mkdir(join(directory, "opencode"));
  const authFile = join(directory, "opencode", "auth.json");
  try {
    await t.test("missing Go auth is explicit; Zen auth is never substituted", async () => {
      await writeFile(authFile, JSON.stringify({ opencode: { key: "zen-only" } }));
      globalThis.fetch = () => {
        throw new Error("must not request without Go auth");
      };
      const result = await openCodeUsage();
      assert.equal(result.status, "unavailable");
      assert.match(result.message, /Go не подключён/);
      assert.equal(result.windows, null);
      await writeFile(authFile, "SECRET invalid JSON");
      await assert.rejects(
        os.tools.readOpenCodeGoKey(),
        (error) => !error.message.includes("SECRET"),
      );
    });
    await t.test("XDG file and OpenCode env override use only the Go entry", async () => {
      await writeFile(authFile, JSON.stringify({ "opencode-go": { key: "file-fixture" } }));
      assert.equal(await os.tools.readOpenCodeGoKey(), "file-fixture");
      process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ "opencode-go": { key: "env-fixture" } });
      assert.equal(await os.tools.readOpenCodeGoKey(), "env-fixture");
    });
    await t.test("concurrent polls, repeated reads and HTTP route share one request", async () => {
      state.value = undefined;
      globalThis.fetch = async (url, options) => {
        calls++;
        assert.equal(url, "https://opencode.ai/zen/go/v1/usage");
        assert.equal(options.headers.Authorization, "Bearer env-fixture");
        assert.equal(options.redirect, "error");
        assert.ok(options.signal instanceof AbortSignal);
        return Response.json({ ...payload, account: "SECRET" });
      };
      const [a, b] = await Promise.all([openCodeUsage(), openCodeUsage()]);
      assert.equal(a, b);
      assert.equal(a.status, "ready");
      assert.equal(await openCodeUsage(), a);
      const headers = {};
      let body;
      const res = {
        setHeader: (key, value) => {
          headers[key] = value;
        },
        end: (value) => {
          body = value;
        },
      };
      assert.equal(await handleOpenCode({ res, method: "GET", path: "/api/opencode/usage" }), true);
      assert.equal(headers["Cache-Control"], "no-store");
      assert.equal(res.statusCode, 200);
      assert.deepEqual(JSON.parse(body), a);
      assert.doesNotMatch(body, /SECRET|fixture|Authorization/);
      assert.equal(calls, 1);
      assert.equal(
        await handleOpenCode({ res, method: "POST", path: "/api/opencode/usage" }),
        false,
      );
      state.value.checkedAt -= 60001;
      await openCodeUsage();
      assert.equal(calls, 2);
    });
    await t.test("auth errors and malformed responses do not expose upstream bodies", async () => {
      for (const status of [401, 403, 429, 500]) {
        state.value = undefined;
        globalThis.fetch = async () => new Response("SECRET upstream details", { status });
        const result = await openCodeUsage();
        assert.equal(result.status, "unavailable");
        assert.equal(result.windows, null);
        assert.doesNotMatch(result.message, /SECRET|fixture/);
        if (status === 401) assert.match(result.message, /истекла/);
        if (status === 403) assert.match(result.message, /Подписка/);
      }
      globalThis.fetch = async () => new Response("SECRET invalid JSON");
      await assert.rejects(readGoUsage(), /Некорректный ответ/);
      state.value = undefined;
      globalThis.fetch = async () => Response.json({ usage: { weekly: window } });
      assert.equal((await openCodeUsage()).status, "unavailable");
    });
    await t.test("hanging requests time out without returning credentials", async () => {
      globalThis.fetch = (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new Error("SECRET request")), {
            once: true,
          });
        });
      // AbortSignal.timeout's timer does not keep Node alive by itself.
      const keepAlive = setInterval(() => {}, 100);
      try {
        await assert.rejects(readGoUsage(20), /Не удалось получить лимиты/);
      } finally {
        clearInterval(keepAlive);
      }
    });
  } finally {
    globalThis.fetch = previousFetch;
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    state.value = undefined;
    await rm(directory, { recursive: true, force: true });
  }
});
