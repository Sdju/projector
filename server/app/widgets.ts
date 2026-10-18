import { registerWidgetDefinition } from "../modules/agents/projector/index.ts";
import { barsWidget } from "../../core/modules/agent-widgets/bars/index.ts";
import { buttonWidget } from "../../core/modules/agent-widgets/button/index.ts";
import { cardWidget } from "../../core/modules/agent-widgets/card/index.ts";
import { checksWidget } from "../../core/modules/agent-widgets/checks/index.ts";
import { columnsWidget } from "../../core/modules/agent-widgets/columns/index.ts";
import { donutWidget } from "../../core/modules/agent-widgets/donut/index.ts";
import { formWidget } from "../../core/modules/agent-widgets/form/index.ts";
import { inputWidget } from "../../core/modules/agent-widgets/input/index.ts";
import { lineWidget } from "../../core/modules/agent-widgets/line/index.ts";
import { rowWidget } from "../../core/modules/agent-widgets/row/index.ts";
import { sliderWidget } from "../../core/modules/agent-widgets/slider/index.ts";
import { statWidget } from "../../core/modules/agent-widgets/stat/index.ts";
import { stepsWidget } from "../../core/modules/agent-widgets/steps/index.ts";
import { tabWidget } from "../../core/modules/agent-widgets/tab/index.ts";
import { tabsWidget } from "../../core/modules/agent-widgets/tabs/index.ts";

/**
 * The components the assistant may use in an answer. The client registers the same set with its
 * implementations (`src/app/widgets.ts`); a test keeps the two lists and the definitions in step.
 */
export function registerBuiltinWidgetDefinitions(): void {
  for (const definition of [
    barsWidget,
    buttonWidget,
    cardWidget,
    checksWidget,
    columnsWidget,
    donutWidget,
    formWidget,
    inputWidget,
    lineWidget,
    rowWidget,
    sliderWidget,
    statWidget,
    stepsWidget,
    tabWidget,
    tabsWidget,
  ])
    registerWidgetDefinition(definition);
}
