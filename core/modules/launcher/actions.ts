import type { LaunchActionId, LaunchDetail, LaunchItem, LauncherClient } from "./launcher.ts";

/** Search results expose primary actions only; detail owns the full action policy. */
export async function resolveLauncherAction(
  client: Pick<LauncherClient, "detail">,
  item: LaunchItem,
  id: LaunchActionId,
  detail?: LaunchDetail | null,
) {
  const actions = detail?.actions ?? (await client.detail(item.id)).actions;
  return actions.find((action) => action.id === id);
}
