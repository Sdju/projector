import SettingsPanel from "./SettingsPanel.vue";
import type { TabViews } from "../workspace/index.ts";
export { SettingsPanel };
export const settingsTabViews: TabViews = {
  settings: {
    component: SettingsPanel,
    keepAlive: true,
    ownKeys: true,
    props: () => ({ embedded: true }),
  },
};
