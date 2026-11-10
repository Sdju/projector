// Runs the evals against a provider saved in Projector (its key comes from the system keyring):
//   node evals/run.mjs <provider id> [model alias] [scenario id…]
// It is a script, not a test: tests must never reach the real keyring (see secrets/vault.ts).
import { registerBuiltinAgents } from "../packages/server/app/agents.ts";
import { registerBuiltinAgentFeatures } from "../packages/server/app/features.ts";
import { registerBuiltinWidgetDefinitions } from "../packages/server/app/widgets.ts";
import { judgeWithWidgets, prepareWidgetChecks, runScenario } from "./harness.mjs";
import { scenarios } from "./scenarios.mjs";

registerBuiltinWidgetDefinitions();
registerBuiltinAgents();
registerBuiltinAgentFeatures();
prepareWidgetChecks();
const [providerId, model, ...only] = process.argv.slice(2);
if (!providerId) {
  console.error("Usage: node evals/run.mjs <provider id> [model alias] [scenario id…]");
  process.exit(2);
}
const runs = Number(process.env.PROJECTOR_EVAL_RUNS) || 1;
let failed = 0;
for (const scenario of scenarios.filter((item) => !only.length || only.includes(item.id))) {
  for (let attempt = 1; attempt <= runs; attempt++) {
    const started = Date.now();
    const run = await runScenario(scenario, { providerId, model, features: scenario.features });
    const failures = await judgeWithWidgets(scenario, run);
    if (failures.length) failed++;
    const calls = run.tools.map((item) => item.name).join(" → ") || "—";
    console.log(
      `${failures.length ? "FAIL" : "ok  "} ${scenario.id} #${attempt} (${Math.round((Date.now() - started) / 1000)} с)`,
    );
    console.log(`     вызовы: ${calls}`);
    if (run.executed.length)
      console.log(`     выполнено: ${run.executed.map((item) => item.command).join(", ")}`);
    console.log(
      `     подтверждений: ${run.approvals.map((item) => item.tool).join(", ") || "0"}, вопросов: ${run.questions.length}`,
    );
    for (const item of run.approvals.filter((entry) => entry.tool === "bash"))
      console.log(
        `     bash: ${String(item.detail ?? "")
          .replace(/\s+/g, " ")
          .slice(0, 200)}`,
      );
    for (const command of run.bashWrites)
      console.log(`     bash отклонён: ${command.slice(0, 200)}`);
    if (run.failed.length)
      console.log(
        `     ошибки инструментов: ${run.failed
          .map((item) => `${item.name}: ${String(item.error).replace(/\s+/g, " ").slice(0, 160)}`)
          .join("; ")}`,
      );
    console.log(`     ответ: ${run.answer.replace(/\s+/g, " ").slice(0, 300)}`);
    for (const item of failures) console.log(`     ✗ ${item}`);
  }
}
console.log(failed ? `\nПровалено: ${failed}` : "\nВсе сценарии пройдены");
process.exit(failed ? 1 : 0);
