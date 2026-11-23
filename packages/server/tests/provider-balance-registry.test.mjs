import { expect, test } from "vite-plus/test";
import { balanceResolver, registerBalanceResolver } from "../modules/providers/index.ts";

const reading = { status: "unsupported", entries: [], available: null, message: null };

test("a built-in reader evaluated again by a hot reload replaces the old one", () => {
  const disposeFirst = registerBalanceResolver({ kind: "hmrbuiltin", read: () => reading });
  const second = { kind: "hmrbuiltin", read: () => reading };
  const disposeSecond = registerBalanceResolver(second);

  expect(balanceResolver("hmrbuiltin")).toBe(second);
  disposeSecond();
  disposeFirst();
  expect(balanceResolver("hmrbuiltin")).toBeUndefined();
});

test("two owners of one kind stay a conflict", () => {
  const dispose = registerBalanceResolver({
    kind: "hmrplugin",
    plugin: "one",
    read: () => reading,
  });

  expect(() =>
    registerBalanceResolver({ kind: "hmrplugin", plugin: "two", read: () => reading }),
  ).toThrow("Вид провайдера уже занят: hmrplugin");
  // A built-in cannot take a kind a plugin already owns, and a plugin cannot take a built-in.
  expect(() => registerBalanceResolver({ kind: "hmrplugin", read: () => reading })).toThrow(
    "Вид провайдера уже занят: hmrplugin",
  );
  expect(() =>
    registerBalanceResolver({ kind: "deepseek", plugin: "three", read: () => reading }),
  ).toThrow("Вид провайдера уже занят: deepseek");
  dispose();
});
