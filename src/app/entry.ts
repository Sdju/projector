import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router.ts";
import { registerBuiltinWidgets } from "./widgets.ts";
import { authedFetch } from "../common/utilities/lan-auth.ts";
import "./styles.css";

window.fetch = authedFetch as typeof fetch;
registerBuiltinWidgets();

createApp(App).use(router).mount("#app");
