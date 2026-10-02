import type dbus from "dbus-next";
import type { ShortcutStatus } from "../shared/launcher.ts";
import { call, watchName } from "./bus.ts";

const keys: Record<string, number> = { "Ctrl+Alt+Space": 0x0c000020, "Super+Space": 0x10000020, "Alt+Space": 0x08000020 };
const action = ["projector", "toggle", "Projector", "Открыть поиск"];
const service = "org.kde.kglobalaccel";
const iface = "org.kde.KGlobalAccel";
const componentIface = "org.kde.kglobalaccel.Component";
const kdeCall = (bus: dbus.MessageBus, method: string, signature = "", values: unknown[] = [], path = "/kglobalaccel", interfaceName = iface) =>
  call(bus, service, path, interfaceName, method, signature, values).then(reply => reply!.body);

export async function available(bus: dbus.MessageBus, shortcut: string) {
  try {
    if (!shortcut) return { supported: true, available: true };
    if (!(shortcut in keys)) throw new Error("Неизвестное сочетание клавиш");
    const [current] = await kdeCall(bus, "shortcut", "as", [action]);
    if (current.includes(keys[shortcut])) return { supported: true, available: true };
    const [free] = await kdeCall(bus, "isGlobalShortcutAvailable", "is", [keys[shortcut], "projector"]);
    return { supported: true, available: Boolean(free) };
  } catch { return { supported: false, available: false }; }
}

export async function shortcutStatus(bus: dbus.MessageBus): Promise<ShortcutStatus> {
  try {
    const [current] = await kdeCall(bus, "shortcut", "as", [action]);
    const [path] = await kdeCall(bus, "getComponent", "s", ["projector"]);
    const [active] = await kdeCall(bus, "isActive", "", [], path, componentIface);
    const shortcut = Object.keys(keys).find(name => current.includes(keys[name])) || "";
    return { supported: true, active: Boolean(active && current.length), shortcut };
  } catch { return { supported: (await available(bus, "Ctrl+Alt+Space")).supported, active: false, shortcut: "" }; }
}

export class Shortcut {
  private unsubscribe?: () => void;
  private unwatch?: () => void;
  private pending: Promise<void> = Promise.resolve();
  private stopped = false;
  private bus: dbus.MessageBus;
  private configured: () => Promise<string>;
  private activate: () => void;

  constructor(bus: dbus.MessageBus, configured: () => Promise<string>, activate: () => void) {
    this.bus = bus; this.configured = configured; this.activate = activate;
  }
  async start() { this.unwatch = await watchName(this.bus, service, () => this.configure()); }
  configure(): Promise<void> {
    const task = this.pending.then(() => this.update());
    this.pending = task.catch(error => console.error("Хоткей:", error.message));
    return task;
  }
  private async update() {
    if (this.stopped) return;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    const shortcut = await this.configured();
    try {
      if (!shortcut) { await kdeCall(this.bus, "unregister", "ss", ["projector", "toggle"]); return; }
      const check = await available(this.bus, shortcut);
      if (!check.supported) return;
      if (!check.available) { await this.deactivate(); console.error(`Горячая клавиша занята: ${shortcut}`); return; }
      await kdeCall(this.bus, "doRegister", "as", [action]);
      // SetPresent | NoAutoloading: explicit preference overrides KDE's old assignment.
      const [registered] = await kdeCall(this.bus, "setShortcut", "asaiu", [action, [keys[shortcut]], 6]);
      if (registered.length !== 1 || registered[0] !== keys[shortcut]) {
        await this.deactivate(); throw new Error("Не удалось назначить горячую клавишу");
      }
      const [path] = await kdeCall(this.bus, "getComponent", "s", ["projector"]);
      const proxy = await this.bus.getProxyObject(service, path);
      const component = proxy.getInterface(componentIface);
      const pressed = (name: string, id: string) => { if (!this.stopped && name === "projector" && id === "toggle") this.activate(); };
      component.on("globalShortcutPressed", pressed);
      this.unsubscribe = () => { component.off("globalShortcutPressed", pressed); };
    } catch (error) { console.error("Хоткей:", error instanceof Error ? error.message : error); }
  }
  private async deactivate() { await kdeCall(this.bus, "setInactive", "as", [action]).catch(() => undefined); }
  async stop() {
    this.stopped = true;
    this.unwatch?.();
    await this.pending;
    this.unsubscribe?.();
    await this.deactivate();
  }
}
