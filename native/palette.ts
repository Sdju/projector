import { createApp, type VioApp } from "vio";
import PaletteComponent from "./Palette.vue";

/** Resident/D-Bus code sees a controller; the widget tree lives entirely in Vue. */
interface PaletteController {
  show(): Promise<void>;
  hide(): boolean;
  toggle(): Promise<void>;
  invokeSelected(toggle?: boolean): Promise<void>;
  openPage(path: string): void;
  quitProjector(): Promise<void>;
}
export class Palette {
  private app: VioApp;
  private controller: PaletteController;
  constructor(baseUrl: string) {
    this.app = createApp(PaletteComponent, { baseUrl });
    this.controller = this.app.mount() as unknown as PaletteController;
  }
  show() { return this.controller.show(); }
  hide() { return this.controller.hide(); }
  toggle() { return this.controller.toggle(); }
  invokeSelected(toggle = false) { return this.controller.invokeSelected(toggle); }
  openPage(path: string) { this.controller.openPage(path); }
  quitProjector() { return this.controller.quitProjector(); }
  dispose() { this.app.unmount(); }
}
