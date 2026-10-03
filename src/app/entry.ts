import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router.ts";
import { authedFetch } from "../common/utilities/lan-auth.ts";
import "./styles.css";

window.fetch = authedFetch as typeof fetch;

createApp(App).use(router).mount("#app");
