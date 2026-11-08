// Widget evals against the real OpenCode ACP agent:
//   node evals/run-widgets.mjs [scenario id…]
// OpenCode keeps its own login/config, so these runs do not replace XDG_DATA_HOME.
import { registerBuiltinAgents } from "../packages/server/app/agents.ts";
import { registerBuiltinAgentFeatures } from "../packages/server/app/features.ts";
import { registerBuiltinWidgetDefinitions } from "../packages/server/app/widgets.ts";
import { opencodeBackend } from "../packages/server/modules/agents/opencode/index.ts";
import { judge, runScenario } from "./harness.mjs";
import { widgetScenarios } from "./widget-scenarios.mjs";

registerBuiltinWidgetDefinitions();
registerBuiltinAgents();
registerBuiltinAgentFeatures();

const only = process.argv.slice(2);
const runs = Number(process.env.PROJECTOR_EVAL_RUNS) || 1;
const selection = process.env.PROJECTOR_EVAL_SELECTION
  ? JSON.parse(process.env.PROJECTOR_EVAL_SELECTION)
  : undefined;
let failed = 0;

for (const scenario of widgetScenarios.filter((item) => !only.length || only.includes(item.id))) {
  for (let attempt = 1; attempt <= runs; attempt++) {
    const started = Date.now();
    const run = await runScenario(scenario, {
      backend: opencodeBackend,
      features: ["widgets"],
      keepDataHome: true,
      selection,
    });
    const failures = judge(scenario, run);
    if (failures.length) failed++;
    const calls = run.tools.map((item) => item.name).join(" → ") || "—";
    console.log(
      `${failures.length ? "FAIL" : "ok  "} ${scenario.id} #${attempt} (${Math.round((Date.now() - started) / 1000)} с)`,
    );
    console.log(`     вызовы: ${calls}`);
    console.log(
      `     подтверждений: ${run.approvals.map((item) => item.tool).join(", ") || "0"}, вопросов: ${run.questions.length}`,
    );
    if (run.failed.length)
      console.log(
        `     ошибки инструментов: ${run.failed
          .map((item) => `${item.name}: ${String(item.error).replace(/\s+/g, " ").slice(0, 160)}`)
          .join("; ")}`,
      );
    console.log(`     ответ: ${run.answer.replace(/\s+/g, " ").slice(0, 500)}`);
    for (const item of failures) console.log(`     ✗ ${item}`);
  }
}
console.log(failed ? `\nПровалено: ${failed}` : "\nВсе сценарии пройдены");
process.exit(failed ? 1 : 0);
