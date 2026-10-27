// One answer of the Projector assistant, held by its own process so that a server restart or a hot
// reload leaves it going: the model request, the tools and the shell commands they started all
// continue, and the restarted server rejoins them through the host's trace.
//
// Usage: node projector-runner.ts <run directory>
import { runHostedRunner } from "../modules/agent/index.ts";
import { runProjector } from "../modules/agents/projector/index.ts";
import { registerBuiltinWidgetDefinitions } from "./widgets.ts";

// The server registers these when it starts; the system prompt of the answer lists them.
registerBuiltinWidgetDefinitions();
runHostedRunner(runProjector);
