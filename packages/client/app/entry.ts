import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router.ts";
import { registerBuiltinWidgets } from "./widgets.ts";
import { registerBuiltinClientAgents } from "./agents.ts";
import { refreshClientAgents } from "../modules/agents-integration/catalog/index.ts";
import { disposePluginRuntime, initPluginRuntime } from "../modules/plugin-runtime/index.ts";
import { deviceRoute } from "../common/utilities/device-url.ts";
import { setInboxNotificationNavigator } from "../modules/agent-core/index.ts";
import { authedFetch } from "../common/utilities/lan-auth.ts";
import { initAppearance } from "../modules/appearance/index.ts";
import { initAppUpdate } from "../modules/app-update/index.ts";
import { initPwa } from "../modules/pwa/index.ts";
import { initAppViewport } from "../common/utilities/app-viewport.ts";
import "./styles.css";

window.fetch = authedFetch as typeof fetch;
initAppearance();
setInboxNotificationNavigator((href) => {
  const route = deviceRoute(href);
  if (route) void router.push(route);
  else location.assign(href);
});
const disposeViewport = initAppViewport();
registerBuiltinWidgets();
registerBuiltinClientAgents();
initPwa();
void initAppUpdate();

// Plugin agents join before the first screen: menus, tabs and settings read one catalog.
await refreshClientAgents();
// Browser contributions load from the same device catalog; a broken package never blocks the app.
void initPluginRuntime();

createApp(App).use(router).mount("#app");

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    disposePluginRuntime();
    disposeViewport();
  });
