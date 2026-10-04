import assert from "node:assert/strict";
import { test } from "node:test";
import { SERVER_MODES, isServerMode, serverCommand } from "../core/modules/server-mode/index.ts";

test("server modes map to vp commands", () => {
  assert.deepEqual(SERVER_MODES, ["dev", "prod"]);
  const paths = { vp: "vp", node: "node", root: "/app" };
  assert.deepEqual(serverCommand("dev", paths), { command: "vp", args: ["dev"] });
  assert.deepEqual(serverCommand("prod", paths), {
    command: "node",
    args: ["/app/server/app/standalone.ts"],
  });
});

test("only known modes are accepted", () => {
  assert.equal(isServerMode("prod"), true);
  assert.equal(isServerMode("preview"), false);
  assert.equal(isServerMode(undefined), false);
});
