import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { weeklyWindow, codexUsage } from "../server/modules/agents-integration/codex/usage.ts";
import { readCodexRateLimits } from "../server/modules/agents-integration/codex/cli.ts";
import { NETWORK_CONTEXT_URL } from "../server/modules/network/index.ts";

const weekly = { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1791574411 };
test("weekly quota follows duration and codex bucket, never another model's quota", () => {
  expect(
    weeklyWindow({
      rateLimits: { primary: { ...weekly, windowDurationMins: 300 }, secondary: weekly },
    }),
  ).toStrictEqual(weekly);
  expect(
    weeklyWindow({
      rateLimitsByLimitId: {
        codex: { primary: weekly },
        base_model_inference: { primary: { ...weekly, usedPercent: 1 } },
      },
    }),
  ).toStrictEqual(weekly);
  expect(weeklyWindow({ rateLimitsByLimitId: { base_model_inference: { primary: weekly } } })).toBe(
    null,
  );
  for (const usedPercent of [-1, 101, NaN, "40"]) {
    expect(weeklyWindow({ rateLimits: { primary: { ...weekly, usedPercent } } })).toBe(null);
  }
  expect(weeklyWindow({ rateLimits: { primary: { ...weekly, windowDurationMins: 300 } } })).toBe(
    null,
  );
  expect(weeklyWindow(null)).toBe(null);
});

describe("Codex stdio handshake, bounded failures and shared usage cache", () => {
  let directory, originalPath, previousFetch, trace, fixture;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "projector-codex-"));
    originalPath = process.env.PATH;
    previousFetch = globalThis.fetch;
    trace = join(directory, "trace.jsonl");
    fixture = `#!/usr/bin/env node
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
      expect(url).toBe(NETWORK_CONTEXT_URL);
      expect(options.redirect).toBe("error");
      expect(options.signal instanceof AbortSignal).toBeTruthy();
      return Response.json({ success: true, is_eu: true, ip: "SECRET" });
    };
  });
  afterAll(async () => {
    globalThis.fetch = previousFetch;
    process.env.PATH = originalPath;
    delete process.env.PROJECTOR_CODEX_MODE;
    delete process.env.PROJECTOR_CODEX_TRACE;
    globalThis.projectorCodexUsage.value = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  test("handshakes, ignores notifications and accepts split JSON responses", async () => {
    expect(weeklyWindow(await readCodexRateLimits())).toStrictEqual(weekly);
    expect(JSON.parse((await readFile(trace, "utf8")).trim())).toStrictEqual([
      "app-server",
      "--stdio",
    ]);
  });
  test("concurrent and cached reads start only one CLI", async () => {
    const state = globalThis.projectorCodexUsage;
    state.value = undefined;
    const before = (await readFile(trace, "utf8")).trim().split("\n").length;
    const [a, b] = await Promise.all([codexUsage(), codexUsage()]);
    expect(a).toBe(b);
    expect(a.status).toBe("ready");
    expect(a.weekly).toStrictEqual(weekly);
    expect(await codexUsage()).toBe(a);
    const after = (await readFile(trace, "utf8")).trim().split("\n").length;
    expect(after - before).toBe(1);
  });
  test("RPC errors are sanitized and returned as unavailable", async () => {
    process.env.PROJECTOR_CODEX_MODE = "error";
    globalThis.projectorCodexUsage.value = undefined;
    const usage = await codexUsage();
    expect(usage.status).toBe("unavailable");
    expect(usage.weekly).toBe(null);
    expect(usage.message).not.toMatch(/SECRET/);
  });
  test("failed network probe blocks Codex CLI usage requests", async () => {
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
      expect(usage.status).toBe("unavailable");
      expect(usage.weekly).toBe(null);
      expect(usage.message).toMatch(/сетевой контекст/);
      expect(usage.message).not.toMatch(/SECRET|US/);
      state.value = undefined;
    }
    const after = (await readFile(trace, "utf8")).trim().split("\n").filter(Boolean).length;
    expect(after).toBe(before);
    globalThis.fetch = async (url) => {
      expect(url).toBe(NETWORK_CONTEXT_URL);
      return Response.json({ success: true, is_eu: true });
    };
  });
  test("hung CLI times out and missing executable rejects", async () => {
    process.env.PROJECTOR_CODEX_MODE = "hang";
    await expect(readCodexRateLimits(100)).rejects.toThrow(/не ответил вовремя/);
    process.env.PATH = join(directory, "missing");
    await expect(readCodexRateLimits()).rejects.toThrow(/недоступен/);
  });
});
