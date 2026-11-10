import { expect, test } from "vite-plus/test";
import { readTerminalClipboard } from "../modules/terminal/lib/clipboard.ts";

test("clipboard read succeeds without a separate permission request", async () => {
  const calls = [];
  const result = await readTerminalClipboard(
    {
      async readText() {
        calls.push("read");
        return "привет🙂";
      },
    },
    {
      async query() {
        calls.push("query");
        return { state: "granted" };
      },
    },
  );
  expect(result).toStrictEqual({ status: "success", text: "привет🙂" });
  expect(calls).toStrictEqual(["read"]);
});

test("clipboard rejection queries permission only after the read attempt", async () => {
  const calls = [];
  const result = await readTerminalClipboard(
    {
      async readText() {
        calls.push("read");
        throw new DOMException("Permission required", "NotAllowedError");
      },
    },
    {
      async query(descriptor) {
        calls.push(descriptor.name);
        return { state: "prompt" };
      },
    },
  );
  expect(result).toStrictEqual({ status: "retry" });
  expect(calls).toStrictEqual(["read", "clipboard-read"]);
});

test("persistent clipboard denial is distinguished from a retryable prompt", async () => {
  const clipboard = {
    async readText() {
      throw new DOMException("Permission denied", "NotAllowedError");
    },
  };
  const permissions = {
    async query() {
      return { state: "denied" };
    },
  };
  expect(await readTerminalClipboard(clipboard, permissions)).toStrictEqual({ status: "denied" });
});

test("missing permission queries and Clipboard API retain paste fallbacks", async () => {
  const clipboard = {
    async readText() {
      throw new Error("Clipboard unavailable");
    },
  };
  expect(await readTerminalClipboard(clipboard, undefined)).toStrictEqual({ status: "retry" });
  expect(
    await readTerminalClipboard(clipboard, {
      async query() {
        throw new TypeError("Unsupported permission");
      },
    }),
  ).toStrictEqual({ status: "retry" });
  expect(await readTerminalClipboard(undefined, undefined)).toStrictEqual({
    status: "unsupported",
  });
});
