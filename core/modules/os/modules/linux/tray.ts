import dbus from "dbus-next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { call, watchName } from "./bus.ts";

const { Interface, ACCESS_READ } = dbus.interface;
type Properties = Record<string, dbus.Variant>;
type Layout = [number, Properties, dbus.Variant[]];
const item = (label: string): Properties => ({
  label: new dbus.Variant("s", label),
  enabled: new dbus.Variant("b", true),
  visible: new dbus.Variant("b", true),
});

/** Exported interfaces use configureMembers, without decorators or a transpiler. */
class StatusNotifier extends Interface {
  Category = "ApplicationStatus";
  Id = "projector";
  Title = "Projector";
  Status = "Active";
  WindowId = 0;
  IconName = fileURLToPath(new URL("../../../../../resources/icons/64.png", import.meta.url));
  IconThemePath = dirname(this.IconName);
  IconPixmap = [];
  OverlayIconName = "";
  OverlayIconPixmap = [];
  AttentionIconName = "";
  AttentionIconPixmap = [];
  AttentionMovieName = "";
  ToolTip = [this.IconName, [], "Projector", "Поиск и запуск приложений"];
  ItemIsMenu = false;
  Menu = "/Menu";
  private activate: () => void;
  constructor(activate: () => void) {
    super("org.kde.StatusNotifierItem");
    this.activate = activate;
  }
  Activate(_x: number, _y: number) {
    this.activate();
  }
  SecondaryActivate(_x: number, _y: number) {
    this.activate();
  }
  ContextMenu(_x: number, _y: number) {}
  Scroll(_delta: number, _orientation: string) {}
  NewIcon() {}
  NewToolTip() {}
  NewStatus(status: string) {
    return status;
  }
}
const propertyTypes: Record<string, string> = {
  Category: "s",
  Id: "s",
  Title: "s",
  Status: "s",
  WindowId: "u",
  IconName: "s",
  IconThemePath: "s",
  IconPixmap: "a(iiay)",
  OverlayIconName: "s",
  OverlayIconPixmap: "a(iiay)",
  AttentionIconName: "s",
  AttentionIconPixmap: "a(iiay)",
  AttentionMovieName: "s",
  ToolTip: "(sa(iiay)ss)",
  ItemIsMenu: "b",
  Menu: "o",
};
StatusNotifier.configureMembers({
  properties: Object.fromEntries(
    Object.entries(propertyTypes).map(([name, signature]) => [
      name,
      { signature, access: ACCESS_READ },
    ]),
  ),
  methods: {
    Activate: { inSignature: "ii" },
    SecondaryActivate: { inSignature: "ii" },
    ContextMenu: { inSignature: "ii" },
    Scroll: { inSignature: "is" },
  },
  signals: {
    NewIcon: { signature: "" },
    NewToolTip: { signature: "" },
    NewStatus: { signature: "s" },
  },
});

class TrayMenu extends Interface {
  Version = 3;
  TextDirection = "ltr";
  Status = "normal";
  private actions: Map<number, () => void>;
  private items = new Map<number, Properties>([
    [0, { "children-display": new dbus.Variant("s", "submenu") }],
    [1, item("Открыть поиск")],
    [3, item("Настройки")],
    [4, { type: new dbus.Variant("s", "separator") }],
    [6, item("Перезапустить")],
    [5, item("Выйти из Projector")],
  ]);
  constructor(actions: Map<number, () => void>) {
    super("com.canonical.dbusmenu");
    this.actions = actions;
  }
  private properties(id: number, names: string[]): Properties {
    const props = this.items.get(id);
    if (!props) throw new dbus.DBusError("com.canonical.dbusmenu.Error", "Unknown item");
    return Object.fromEntries(
      Object.entries(props).filter(([name]) => !names.length || names.includes(name)),
    );
  }
  private layout(id: number, depth: number, names: string[]): Layout {
    return [
      id,
      this.properties(id, names),
      id === 0 && depth !== 0
        ? [1, 2, 3, 4, 6, 5].map(
            (child) => new dbus.Variant("(ia{sv}av)", this.layout(child, depth - 1, names)),
          )
        : [],
    ];
  }
  GetLayout(id: number, depth: number, names: string[]) {
    return [1, this.layout(id, depth, names)];
  }
  GetGroupProperties(ids: number[], names: string[]) {
    return ids.filter((id) => this.items.has(id)).map((id) => [id, this.properties(id, names)]);
  }
  GetProperty(id: number, name: string) {
    const prop = this.items.get(id)?.[name];
    if (!prop) throw new dbus.DBusError("com.canonical.dbusmenu.Error", "Unknown property");
    return prop;
  }
  Event(id: number, event: string, _data: dbus.Variant, _timestamp: number) {
    if (event === "clicked") this.actions.get(id)?.();
  }
  EventGroup(events: [number, string, dbus.Variant, number][]) {
    for (const event of events) this.Event(...event);
    return [];
  }
  AboutToShow(_id: number) {
    return false;
  }
  AboutToShowGroup(_ids: number[]) {
    return [[], []];
  }
  LayoutUpdated(revision: number, parent: number) {
    return [revision, parent];
  }
  ItemsPropertiesUpdated(updated: unknown[], removed: unknown[]) {
    return [updated, removed];
  }
}
TrayMenu.configureMembers({
  properties: {
    Version: { signature: "u", access: ACCESS_READ },
    TextDirection: { signature: "s", access: ACCESS_READ },
    Status: { signature: "s", access: ACCESS_READ },
  },
  methods: {
    GetLayout: { inSignature: "iias", outSignature: "u(ia{sv}av)" },
    GetGroupProperties: { inSignature: "aias", outSignature: "a(ia{sv})" },
    GetProperty: { inSignature: "is", outSignature: "v" },
    Event: { inSignature: "isvu" },
    EventGroup: { inSignature: "a(isvu)", outSignature: "ai" },
    AboutToShow: { inSignature: "i", outSignature: "b" },
    AboutToShowGroup: { inSignature: "ai", outSignature: "aiai" },
  },
  signals: {
    LayoutUpdated: { signature: "ui" },
    ItemsPropertiesUpdated: { signature: "a(ia{sv})a(ias)" },
  },
});

export async function startTray(
  bus: dbus.MessageBus,
  activate: () => void,
  openPage: (path: string) => void,
  quit: () => void,
  restart: () => void,
) {
  const sni = new StatusNotifier(activate);
  const menu = new TrayMenu(
    new Map([
      [1, activate],
      [3, () => openPage("/settings")],
      [5, quit],
      [6, restart],
    ]),
  );
  bus.export("/StatusNotifierItem", sni);
  bus.export("/Menu", menu);
  const unwatch = await watchName(bus, "org.kde.StatusNotifierWatcher", async () => {
    await call(
      bus,
      "org.kde.StatusNotifierWatcher",
      "/StatusNotifierWatcher",
      "org.kde.StatusNotifierWatcher",
      "RegisterStatusNotifierItem",
      "s",
      ["/StatusNotifierItem"],
    );
  }).catch((error) => {
    console.error("Трей:", error.message);
    return () => {};
  });
  return () => {
    unwatch();
    bus.unexport("/StatusNotifierItem", sni);
    bus.unexport("/Menu", menu);
  };
}
