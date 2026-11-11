import { nextTick, ref } from "vue";

/** Chat-role the settings should scroll to after opening from the new-session island. */
export const focusedRoleId = ref("");

/** Scrolls the role card into view once its settings page is on screen. */
export async function revealFocusedRole(id: string): Promise<void> {
  if (!id || focusedRoleId.value !== id) return;
  await nextTick();
  await nextTick();
  document.querySelector(`[data-role-id="${CSS.escape(id)}"]`)?.scrollIntoView({
    block: "nearest",
  });
  if (focusedRoleId.value === id) focusedRoleId.value = "";
}
