import dbus from "dbus-next";
import type { SecretKey } from "../../contract.ts";

const SERVICE = "org.freedesktop.secrets";
const ROOT = "/org/freedesktop/secrets";
const PROMPT_TIMEOUT = 120_000;
const CALL_TIMEOUT = 5_000;

const attributes = ({ service, account }: SecretKey) => ({
  application: "projector",
  service,
  account,
});

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Secret Service: ${what} не ответил`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Waits for the user to answer a keyring unlock/confirmation dialog. */
async function runPrompt(bus: dbus.MessageBus, path: string): Promise<boolean> {
  if (path === "/") return true;
  const object = await bus.getProxyObject(SERVICE, path);
  const prompt = object.getInterface("org.freedesktop.Secret.Prompt");
  const done = new Promise<boolean>((resolve) => {
    prompt.once("Completed", (dismissed: boolean) => resolve(!dismissed));
  });
  await prompt.Prompt("");
  return withTimeout(done, PROMPT_TIMEOUT, "диалог разблокировки");
}

async function withService<T>(
  action: (context: {
    bus: dbus.MessageBus;
    service: dbus.ClientInterface;
    session: string;
  }) => Promise<T>,
): Promise<T> {
  if (!process.env.DBUS_SESSION_BUS_ADDRESS) throw new Error("Session D-Bus недоступна");
  const bus = dbus.sessionBus();
  bus.on("error", () => {});
  try {
    const object = await withTimeout(
      bus.getProxyObject(SERVICE, ROOT),
      CALL_TIMEOUT,
      "подключение",
    );
    const service = object.getInterface("org.freedesktop.Secret.Service");
    // `plain` keeps the secret off disk; the transport is the user's private session bus.
    const opened: [unknown, string] = await withTimeout(
      service.OpenSession("plain", new dbus.Variant("s", "")),
      CALL_TIMEOUT,
      "OpenSession",
    );
    const session = opened[1];
    return await action({ bus, service, session });
  } finally {
    bus.disconnect();
  }
}

async function defaultCollection(bus: dbus.MessageBus, service: dbus.ClientInterface) {
  const path: string = await service.ReadAlias("default");
  if (path === "/") throw new Error("В системном хранилище нет коллекции по умолчанию");
  const object = await bus.getProxyObject(SERVICE, path);
  const properties = object.getInterface("org.freedesktop.DBus.Properties");
  const locked = (await properties.Get("org.freedesktop.Secret.Collection", "Locked")).value;
  if (locked) {
    const [, prompt] = await service.Unlock([path]);
    if (!(await runPrompt(bus, prompt))) throw new Error("Хранилище секретов не разблокировано");
  }
  return { path, collection: object.getInterface("org.freedesktop.Secret.Collection") };
}

async function find(service: dbus.ClientInterface, key: SecretKey) {
  const [unlocked, locked]: [string[], string[]] = await service.SearchItems(attributes(key));
  return { unlocked, locked };
}

async function unlockItems(bus: dbus.MessageBus, service: dbus.ClientInterface, items: string[]) {
  if (!items.length) return;
  const [, prompt] = await service.Unlock(items);
  if (!(await runPrompt(bus, prompt))) throw new Error("Хранилище секретов не разблокировано");
}

export async function secretsAvailable(): Promise<boolean> {
  try {
    return await withService(async ({ service }) => (await service.ReadAlias("default")) !== "/");
  } catch {
    return false;
  }
}

export function getSecret(key: SecretKey): Promise<string | undefined> {
  return withService(async ({ bus, service, session }) => {
    const { unlocked, locked } = await find(service, key);
    let item = unlocked[0];
    if (!item && locked[0]) {
      await unlockItems(bus, service, [locked[0]]);
      item = locked[0];
    }
    if (!item) return undefined;
    const proxy = await bus.getProxyObject(SERVICE, item);
    const secret = await proxy.getInterface("org.freedesktop.Secret.Item").GetSecret(session);
    return Buffer.from(secret[2]).toString("utf8");
  });
}

export function setSecret(key: SecretKey, label: string, value: string): Promise<void> {
  return withService(async ({ bus, service, session }) => {
    const { collection } = await defaultCollection(bus, service);
    const [, prompt] = await collection.CreateItem(
      {
        "org.freedesktop.Secret.Item.Label": new dbus.Variant("s", label),
        "org.freedesktop.Secret.Item.Attributes": new dbus.Variant("a{ss}", attributes(key)),
      },
      [session, [], Buffer.from(value, "utf8"), "text/plain"],
      true,
    );
    if (!(await runPrompt(bus, prompt))) throw new Error("Сохранение секрета отклонено");
  });
}

export function deleteSecret(key: SecretKey): Promise<void> {
  return withService(async ({ bus, service }) => {
    const { unlocked, locked } = await find(service, key);
    await unlockItems(bus, service, locked);
    for (const path of [...unlocked, ...locked]) {
      const proxy = await bus.getProxyObject(SERVICE, path);
      const prompt: string = await proxy.getInterface("org.freedesktop.Secret.Item").Delete();
      await runPrompt(bus, prompt);
    }
  });
}
