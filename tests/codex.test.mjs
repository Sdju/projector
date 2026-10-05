import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { weeklyWindow, codexUsage } from "../server/modules/agents-integration/codex/usage.ts";
import { readCodexRateLimits } from "../server/modules/agents-integration/codex/cli.ts";
import { NETWORK_CONTEXT_URL } from "../server/modules/network/index.ts";

const weekly = { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1791574411 };
test("weekly quota follows duration and codex bucket, never another model's quota", () => {
  assert.deepEqual(
    weeklyWindow({
      rateLimits: { primary: { ...weekly, windowDurationMins: 300 }, secondary: weekly },
    }),
    weekly,
  );
  assert.deepEqual(
    weeklyWindow({
      rateLimitsByLimitId: {
        codex: { primary: weekly },
        base_model_inference: { primary: { ...weekly, usedPercent: 1 } },
      },
    }),
    weekly,
  );
  assert.equal(
    weeklyWindow({ rateLimitsByLimitId: { base_model_inference: { primary: weekly } } }),
    null,
  );
  for (const usedPercent of [-1, 101, NaN, "40"]) {
    assert.equal(weeklyWindow({ rateLimits: { primary: { ...weekly, usedPercent } } }), null);
  }
  assert.equal(
    weeklyWindow({ rateLimits: { primary: { ...weekly, windowDurationMins: 300 } } }),
    null,
  );
  assert.equal(weeklyWindow(null), null);
});

test("Codex stdio handshake, bounded failures and shared usage cache", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "projector-codex-"));
  const originalPath = process.env.PATH;
  const previousFetch = globalThis.fetch;
  const trace = join(directory, "trace.jsonl");
  const fixture = `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.PROJECTOR_CODEX_TRACE, JSON.stringify(process.argv.slice(2))+'\\n');
let buffer = ''; let initialized = false;
process.stdin.on('data', chunk => {
 buffer += chunk;
 while(buffer.includes('\\n')) {
  const end = buffer.indexOf('\\n'); const line = buffer.slice(0,end); buffer=buffer.slice(end+1);
  const m=JSON.parse(line);
  if(m.method==='initialize') {
   if(process.env.PROJECTOR_CODEX_MODE==='hang') continue;
   process.stdout.write(JSON.stringify({id:1,result:{}})+'\\n');
  } else if(m.method==='initialized') initialized=true;
  else if(m.method==='account/rateLimits/read') {
   if(!initialized || !m.params.excludeResetCreditDetails) process.exit(2);
   if(process.env.PROJECTOR_CODEX_MODE==='error') process.stdout.write(JSON.stringify({id:2,error:{message:'SECRET backend details'}})+'\\n');
   else {
    const response=JSON.stringify({id:2,result:{rateLimits:{primary:${JSON.stringify(weekly)}}}})+'\\n';
    process.stdout.write('not-json\\n'+JSON.stringify({method:'notification',params:{}})+'\\n'+response.slice(0,15));
    setTimeout(()=>process.stdout.write(response.slice(15)),10);
  }
 }
}
});
`;
  await writeFile(join(directory, "codex"), fixture, { mode: 0o755 });
  process.env.PATH = `${directory}:${originalPath}`;
  process.env.PROJECTOR_CODEX_TRACE = trace;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, NETWORK_CONTEXT_URL);
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ success: true, is_eu: true, ip: "SECRET" });
  };
  try {
    await t.test("handshakes, ignores notifications and accepts split JSON responses", async () => {
      assert.deepEqual(weeklyWindow(await readCodexRateLimits()), weekly);
      assert.deepEqual(JSON.parse((await readFile(trace, "utf8")).trim()), [
        "app-server",
        "--stdio",
      ]);
    });
    await t.test("concurrent and cached reads start only one CLI", async () => {
      const state = globalThis.projectorCodexUsage;
      state.value = undefined;
      const before = (await readFile(trace, "utf8")).trim().split("\n").length;
      const [a, b] = await Promise.all([codexUsage(), codexUsage()]);
      assert.equal(a, b);
      assert.equal(a.status, "ready");
      assert.deepEqual(a.weekly, weekly);
      assert.equal(await codexUsage(), a);
      const after = (await readFile(trace, "utf8")).trim().split("\n").length;
      assert.equal(after - before, 1);
    });
    await t.test("RPC errors are sanitized and returned as unavailable", async () => {
      process.env.PROJECTOR_CODEX_MODE = "error";
      globalThis.projectorCodexUsage.value = undefined;
      const usage = await codexUsage();
      assert.equal(usage.status, "unavailable");
      assert.equal(usage.weekly, null);
      assert.doesNotMatch(usage.message, /SECRET/);
    });
    await t.test("failed network probe blocks Codex CLI usage requests", async () => {
      const state = globalThis.projectorCodexUsage;
      state.value = undefined;
      delete process.env.PROJECTOR_CODEX_MODE;
      const before = (await readFile(trace, "utf8")).trim().split("\n").filter(Boolean).length;
      for (const body of [
        { success: false, is_eu: true, message: "SECRET" },
        { success: true, is_eu: false, country_code: "US" },
        { success: true, ip: "SECRET" },
      ]) {
        globalThis.fetch = async () => Response.json(body);
        const usage = await codexUsage();
        assert.equal(usage.status, "unavailable");
        assert.equal(usage.weekly, null);
        assert.match(usage.message, /сетевой контекст/);
        assert.doesNotMatch(usage.message, /SECRET|US/);
        state.value = undefined;
      }
      const after = (await readFile(trace, "utf8")).trim().split("\n").filter(Boolean).length;
      assert.equal(after, before);
      globalThis.fetch = async (url) => {
        assert.equal(url, NETWORK_CONTEXT_URL);
        return Response.json({ success: true, is_eu: true });
      };
    });
    await t.test("hung CLI times out and missing executable rejects", async () => {
      process.env.PROJECTOR_CODEX_MODE = "hang";
      await assert.rejects(readCodexRateLimits(100), /не ответил вовремя/);
      process.env.PATH = join(directory, "missing");
      await assert.rejects(readCodexRateLimits(), /недоступен/);
    });
  } finally {
    globalThis.fetch = previousFetch;
    process.env.PATH = originalPath;
    delete process.env.PROJECTOR_CODEX_MODE;
    delete process.env.PROJECTOR_CODEX_TRACE;
    globalThis.projectorCodexUsage.value = undefined;
    await rm(directory, { recursive: true, force: true });
  }
});
