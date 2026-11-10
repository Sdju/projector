import { registerWidgetDefinition } from "../modules/agents/projector/index.ts";
import { barsWidget } from "@ai-projector/core/modules/agent-widgets/bars/index.ts";
import { buttonWidget } from "@ai-projector/core/modules/agent-widgets/button/index.ts";
import { cardWidget } from "@ai-projector/core/modules/agent-widgets/card/index.ts";
import { checksWidget } from "@ai-projector/core/modules/agent-widgets/checks/index.ts";
import { chipsWidget } from "@ai-projector/core/modules/agent-widgets/chips/index.ts";
import { columnsWidget } from "@ai-projector/core/modules/agent-widgets/columns/index.ts";
import { donutWidget } from "@ai-projector/core/modules/agent-widgets/donut/index.ts";
import { fieldWidget } from "@ai-projector/core/modules/agent-widgets/field/index.ts";
import { formWidget } from "@ai-projector/core/modules/agent-widgets/form/index.ts";
import { gitInfoWidget } from "@ai-projector/core/modules/agent-widgets/git-info/index.ts";
import { imageWidget } from "@ai-projector/core/modules/agent-widgets/image/index.ts";
import { inlineIconWidget } from "@ai-projector/core/modules/agent-widgets/inline-icon/index.ts";
import { inputWidget } from "@ai-projector/core/modules/agent-widgets/input/index.ts";
import { intelligentFormWidget } from "@ai-projector/core/modules/agent-widgets/intelligent-form/index.ts";
import { lineWidget } from "@ai-projector/core/modules/agent-widgets/line/index.ts";
import { rowWidget } from "@ai-projector/core/modules/agent-widgets/row/index.ts";
import { safeSecretShowWidget } from "@ai-projector/core/modules/agent-widgets/safe-secret-show/index.ts";
import { sliderWidget } from "@ai-projector/core/modules/agent-widgets/slider/index.ts";
import { statWidget } from "@ai-projector/core/modules/agent-widgets/stat/index.ts";
import { stepsWidget } from "@ai-projector/core/modules/agent-widgets/steps/index.ts";
import { tabWidget } from "@ai-projector/core/modules/agent-widgets/tab/index.ts";
import { tabsWidget } from "@ai-projector/core/modules/agent-widgets/tabs/index.ts";

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
    chipsWidget,
    columnsWidget,
    donutWidget,
    fieldWidget,
    formWidget,
    gitInfoWidget,
    imageWidget,
    inlineIconWidget,
    inputWidget,
    intelligentFormWidget,
    lineWidget,
    rowWidget,
    safeSecretShowWidget,
    sliderWidget,
    statWidget,
    stepsWidget,
    tabWidget,
    tabsWidget,
  ])
    registerWidgetDefinition(definition);
}
