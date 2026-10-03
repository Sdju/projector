import assert from "node:assert/strict";
import { test } from "node:test";
import { SERVER_MODES, isServerMode, serverCommand } from "../core/modules/server-mode/index.ts";

test("server modes map to vp commands", () => {
  assert.deepEqual(SERVER_MODES, ["dev", "prod"]);
  assert.deepEqual(serverCommand("dev"), ["dev"]);
  assert.deepEqual(serverCommand("prod"), ["preview"]);
});

test("only known modes are accepted", () => {
  assert.equal(isServerMode("prod"), true);
  assert.equal(isServerMode("preview"), false);
  assert.equal(isServerMode(undefined), false);
});
