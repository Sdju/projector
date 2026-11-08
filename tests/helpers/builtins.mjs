// The live agent, widget and feature catalogs are composed by the server app. Tests that read or
// change those catalogs import this helper explicitly; the other files do not pay for the graph.
import { registerBuiltinAgents } from "../../packages/server/app/agents.ts";
import { registerBuiltinWidgetDefinitions } from "../../packages/server/app/widgets.ts";
import { registerBuiltinAgentFeatures } from "../../packages/server/app/features.ts";

registerBuiltinAgents();
registerBuiltinWidgetDefinitions();
registerBuiltinAgentFeatures();
