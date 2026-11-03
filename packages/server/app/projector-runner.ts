// One answer of the Projector assistant, held by its own process so that a server restart or a hot
// reload leaves it going: the model request, the tools and the shell commands they started all
// continue, and the restarted server rejoins them through the host's trace.
//
// Usage: node projector-runner.ts <run directory>
import { registerAgentBackend, runHostedRunner } from "../modules/agent/index.ts";
import { projectorBackend, runProjector } from "../modules/agents/projector/index.ts";
import { registerBuiltinWidgetDefinitions } from "./widgets.ts";
import { registerBuiltinAgentFeatures } from "./features.ts";

// The server registers these when it starts; the system prompt of the answer lists them. This
// process runs one agent, so it registers that backend before the features ask for the catalog.
registerAgentBackend(projectorBackend, { asDefault: true });
registerBuiltinWidgetDefinitions();
registerBuiltinAgentFeatures();
runHostedRunner(runProjector);
