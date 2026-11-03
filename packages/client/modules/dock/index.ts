export { default as DockView } from "./ui/DockView.vue";
export type { DockTabInfo } from "./ui/context.ts";
export {
  activatePanel,
  addPanel,
  createDockLayout,
  dockGroups,
  findDockGroup,
  groupOfPanel,
  movePanel,
  parseDockLayout,
  reconcileDock,
  replacePanel,
  serializeDockLayout,
  setGroupHidden,
} from "./model/layout.ts";
export type { DockGroup, DockLayout, DockTarget } from "./model/layout.ts";
