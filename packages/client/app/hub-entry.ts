import { createApp } from "vue";
import HubApp from "./HubApp.vue";
import { initAppearance } from "../modules/appearance/index.ts";
import "./styles.css";
initAppearance();
createApp(HubApp).mount("#app");
