import { registerWidget } from "../modules/widget-runtime/index.ts";
import { bars } from "../modules/agent-widgets/bars/index.ts";
import { button } from "../modules/agent-widgets/button/index.ts";
import { card } from "../modules/agent-widgets/card/index.ts";
import { checks } from "../modules/agent-widgets/checks/index.ts";
import { columns } from "../modules/agent-widgets/columns/index.ts";
import { donut } from "../modules/agent-widgets/donut/index.ts";
import { form } from "../modules/agent-widgets/form/index.ts";
import { input } from "../modules/agent-widgets/input/index.ts";
import { line } from "../modules/agent-widgets/line/index.ts";
import { row } from "../modules/agent-widgets/row/index.ts";
import { slider } from "../modules/agent-widgets/slider/index.ts";
import { stat } from "../modules/agent-widgets/stat/index.ts";
import { steps } from "../modules/agent-widgets/steps/index.ts";
import { tab } from "../modules/agent-widgets/tab/index.ts";
import { tabs } from "../modules/agent-widgets/tabs/index.ts";

/**
 * The components an answer may use. The composition is the only place that names them: each one is
 * a module of its own and the chat never imports one. Registering again replaces.
 */
export function registerBuiltinWidgets(): void {
  for (const entry of [
    bars,
    button,
    card,
    checks,
    columns,
    donut,
    form,
    input,
    line,
    row,
    slider,
    stat,
    steps,
    tab,
    tabs,
  ])
    registerWidget(entry);
}
