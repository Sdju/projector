// Runs the Projector Judge evals against a saved provider (its key comes from the system keyring):
//   node evals/judge.mjs <provider id> [model alias] [scenario id…]
// Set OPENAI_URL/OPENAI_API_KEY/OPENAI_MODEL and pass `env` to use an ad-hoc provider instead.
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { judgeAction, clearJudgeCache } from "../packages/server/modules/judge/index.ts";
import { judgeAllows } from "../packages/core/modules/agent-judge/index.ts";
import { JUDGE_EVAL_SETTINGS, judgeScenarios, judgeVerdict } from "./judge-scenarios.mjs";

const [providerId, model, ...only] = process.argv.slice(2);
if (!providerId) {
  console.error("Usage: node evals/judge.mjs <provider id|env> [model alias] [scenario id…]");
  process.exit(2);
}

const data = await mkdtemp(join(tmpdir(), "projector-judge-eval-"));
const saved = {};
const set = (name, value) => {
  saved[name] = process.env[name];
  process.env[name] = value;
};
set("XDG_DATA_HOME", data);
if (providerId === "env") {
  if (!process.env.OPENAI_URL) {
    console.error("Для env задайте OPENAI_URL, OPENAI_API_KEY и OPENAI_MODEL");
    process.exit(2);
  }
} else {
  const home = join(
    process.env.PROJECTOR_EVAL_DATA || join(homedir(), ".local", "share"),
    "projector",
    "providers.json",
  );
  const savedProviders = JSON.parse(await readFile(home, "utf8"));
  const record = savedProviders.providers.find((item) => item.id === providerId);
  if (!record) {
    console.error(`Нет провайдера ${providerId}`);
    process.exit(2);
  }
  await mkdir(join(data, "projector"), { recursive: true });
  await writeFile(
    join(data, "projector", "providers.json"),
    JSON.stringify({ activeProviderId: record.id, providers: [record] }),
  );
}

const selected = judgeScenarios.filter((item) => !only.length || only.includes(item.id));
const started = Date.now();
let failed = 0;
let totalScore = 0;
console.log(
  `Projector Judge · ${providerId}${model ? `/${model}` : ""} · политика: риск ≤ ${JUDGE_EVAL_SETTINGS.maxRisk}, уверенность ${JUDGE_EVAL_SETTINGS.confidence}`,
);
for (const scenario of selected) {
  clearJudgeCache();
  const begin = Date.now();
  const verdict = await judgeAction({
    ...scenario.action,
    cwd: process.cwd(),
    selection: providerId === "env" ? undefined : { provider: `${providerId}:${model ?? ""}` },
  });
  const failures = judgeVerdict(scenario, verdict);
  if (failures.length) failed++;
  totalScore += verdict.score;
  const auto = judgeAllows(JUDGE_EVAL_SETTINGS, verdict);
  const seconds = ((Date.now() - begin) / 1000).toFixed(1);
  console.log(
    `${failures.length ? "FAIL" : "ok  "} ${scenario.id.padEnd(20)} ${verdict.score}/5 · ${verdict.confidence.padEnd(6)} · ${auto ? "авто " : "карточка"} · ${seconds} с · ${verdict.reason}`,
  );
  for (const item of failures) console.log(`     ✗ ${item}`);
}
console.log(
  `\nИтог: ${selected.length - failed}/${selected.length} · средний балл ${(totalScore / Math.max(1, selected.length)).toFixed(2)} · ${Math.round((Date.now() - started) / 1000)} с`,
);
for (const [name, value] of Object.entries(saved)) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
process.exit(failed ? 1 : 0);
