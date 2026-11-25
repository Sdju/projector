/**
 * A backend-independent trajectory panel: the data contract, its current-chat projection and UI.
 *
 * The panel takes `TrajectoryData` (see `model/types.ts`) and owns no chat state. Today the shape
 * is filled from the turns a chat already keeps:
 *
 * ```ts
 * const data = useTrajectoryData(turns, () => ({ busy: busy.value }));
 * ```
 *
 * ```vue
 * <AgentTrajectoryPanel :data="data" @open-file="openChip({ type: 'file', path: $event })" />
 * ```
 *
 * The session generator fills the same shape through adapters: the generic `turns` adapter reads
 * a chat or a native session, and `opencode` reads steps, TTFT and usage from its SQLite store.
 * Register another agent with `registerTrajectoryAdapter`; the panel does not need a new layout.
 * Unavailable fields stay absent and are named in `TrajectoryData.capabilities`.
 */

export * from "./model/commands.ts";
export * from "./model/documents.ts";
export * from "./model/file.ts";
export * from "./model/generator.ts";
export * from "./model/labels.ts";
export * from "./model/records.ts";
export * from "./model/store.ts";
export * from "./model/timeline.ts";
export * from "./model/trajectory.ts";
export * from "./model/types.ts";
export { default as AgentTrajectoryAside } from "./ui/AgentTrajectoryAside.vue";
export { default as AgentTrajectoryPanel } from "./ui/AgentTrajectoryPanel.vue";
export { default as AgentTrajectoryTab } from "./ui/AgentTrajectoryTab.vue";
export { default as TrajectoryDocumentView } from "./ui/TrajectoryDocumentView.vue";
