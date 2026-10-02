import dbus from "dbus-next";

export function sessionBus() {
  const bus = dbus.sessionBus();
  // Surface errors without an unhandled EventEmitter error terminating GTK.
  bus.on("error", (error) => console.error("D-Bus:", error.message));
  return bus;
}

export async function call(
  bus: dbus.MessageBus,
  destination: string,
  path: string,
  iface: string,
  member: string,
  signature = "",
  body: unknown[] = [],
) {
  const message = new dbus.Message({
    destination,
    path,
    interface: iface,
    member,
    signature,
    body,
    flags: dbus.MessageFlag.NO_AUTO_START,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      bus.call(message),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`D-Bus: ${member} не ответил`)), 3000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Watch service restarts (Plasma or kglobalaccel), and its initial presence. */
export async function watchName(bus: dbus.MessageBus, name: string, appeared: () => Promise<void>) {
  const proxy = await bus.getProxyObject("org.freedesktop.DBus", "/org/freedesktop/DBus");
  const daemon = proxy.getInterface("org.freedesktop.DBus");
  const invoke = () => {
    void appeared().catch((error) => console.error(`${name}:`, error.message));
  };
  const changed = (changedName: string, _old: string, owner: string) => {
    if (changedName === name && owner) invoke();
  };
  daemon.on("NameOwnerChanged", changed);
  if (await daemon.NameHasOwner(name)) await appeared();
  return () => {
    daemon.off("NameOwnerChanged", changed);
  };
}
