import { ref } from "vue";

/**
 * Section shown in the Projector settings tab. Other places (the new-session island, commands)
 * choose it before opening the tab, the same way project settings use `projectSettingsSection`.
 */
export const appSettingsSection = ref("interface");
