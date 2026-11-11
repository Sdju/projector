import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router.ts";
import { registerBuiltinWidgets } from "./widgets.ts";
import { registerBuiltinClientAgents } from "./agents.ts";
import { refreshClientAgents } from "../modules/agents-integration/catalog/index.ts";
import { authedFetch } from "../common/utilities/lan-auth.ts";
import { initAppearance } from "../modules/appearance/index.ts";
import { initPwa } from "../modules/pwa/index.ts";
import "./styles.css";

window.fetch = authedFetch as typeof fetch;
initAppearance();
registerBuiltinWidgets();
registerBuiltinClientAgents();
initPwa();

// Plugin agents join before the first screen: menus, tabs and settings read one catalog.
await refreshClientAgents();

createApp(App).use(router).mount("#app");
