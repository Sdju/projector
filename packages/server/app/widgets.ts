import { registerWidgetDefinition } from "../modules/agents/projector/index.ts";
import { barsWidget } from "@projector-ai/core/modules/agent-widgets/bars/index.ts";
import { buttonWidget } from "@projector-ai/core/modules/agent-widgets/button/index.ts";
import { cardWidget } from "@projector-ai/core/modules/agent-widgets/card/index.ts";
import { checksWidget } from "@projector-ai/core/modules/agent-widgets/checks/index.ts";
import { chipsWidget } from "@projector-ai/core/modules/agent-widgets/chips/index.ts";
import { columnsWidget } from "@projector-ai/core/modules/agent-widgets/columns/index.ts";
import { donutWidget } from "@projector-ai/core/modules/agent-widgets/donut/index.ts";
import { fieldWidget } from "@projector-ai/core/modules/agent-widgets/field/index.ts";
import { formWidget } from "@projector-ai/core/modules/agent-widgets/form/index.ts";
import { gitInfoWidget } from "@projector-ai/core/modules/agent-widgets/git-info/index.ts";
import { imageWidget } from "@projector-ai/core/modules/agent-widgets/image/index.ts";
import { inlineIconWidget } from "@projector-ai/core/modules/agent-widgets/inline-icon/index.ts";
import { inputWidget } from "@projector-ai/core/modules/agent-widgets/input/index.ts";
import { intelligentFormWidget } from "@projector-ai/core/modules/agent-widgets/intelligent-form/index.ts";
import { lineWidget } from "@projector-ai/core/modules/agent-widgets/line/index.ts";
import { rowWidget } from "@projector-ai/core/modules/agent-widgets/row/index.ts";
import { safeSecretShowWidget } from "@projector-ai/core/modules/agent-widgets/safe-secret-show/index.ts";
import { sliderWidget } from "@projector-ai/core/modules/agent-widgets/slider/index.ts";
import { statWidget } from "@projector-ai/core/modules/agent-widgets/stat/index.ts";
import { stepsWidget } from "@projector-ai/core/modules/agent-widgets/steps/index.ts";
import { tabWidget } from "@projector-ai/core/modules/agent-widgets/tab/index.ts";
import { tabsWidget } from "@projector-ai/core/modules/agent-widgets/tabs/index.ts";

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
