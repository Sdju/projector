import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router.ts";
import { registerBuiltinWidgets } from "./widgets.ts";
import { registerBuiltinClientAgents } from "./agents.ts";
import { authedFetch } from "../common/utilities/lan-auth.ts";
import "./styles.css";

window.fetch = authedFetch as typeof fetch;
registerBuiltinWidgets();
registerBuiltinClientAgents();

createApp(App).use(router).mount("#app");
