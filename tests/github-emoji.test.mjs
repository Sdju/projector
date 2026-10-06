import assert from "node:assert/strict";
import { test, mock } from "node:test";
import {
  REACTION_EMOJI,
  loadGithubEmojis,
  splitEmoji,
} from "../src/common/utilities/github-emoji.ts";

const map = {
  tada: "https://img/tada.png",
  smile: "https://img/smile.png",
  "+1": "https://img/plus.png",
  constructor: undefined,
};

test("splitEmoji replaces known shortcodes and leaves the rest as written", () => {
  assert.deepEqual(splitEmoji("Ship :tada: now :nope: and :+1:", map), [
    "Ship ",
    { name: "tada", url: "https://img/tada.png" },
    " now :nope: and ",
    { name: "+1", url: "https://img/plus.png" },
  ]);
  assert.deepEqual(splitEmoji("12:30:45", map), ["12:30:45"]);
  // Object prototype keys are not emoji.
  assert.deepEqual(splitEmoji(":constructor: :toString:", map), [":constructor: :toString:"]);
  assert.deepEqual(splitEmoji(":TADA:", map), [{ name: "tada", url: "https://img/tada.png" }]);
});

test("every reaction has an emoji name GitHub actually lists", () => {
  assert.equal(REACTION_EMOJI.laugh, "smile");
  assert.equal(REACTION_EMOJI.hooray, "tada");
  assert.equal(Object.keys(REACTION_EMOJI).length, 8);
});

test("the emoji list is loaded once and a failed load can be retried", async () => {
  let calls = 0;
  const fetch = mock.method(globalThis, "fetch", async () => {
    calls++;
    return calls === 1 ? new Response("", { status: 500 }) : Response.json(map);
  });
  try {
    assert.deepEqual(await loadGithubEmojis(), {});
    assert.equal((await loadGithubEmojis()).tada, "https://img/tada.png");
    await loadGithubEmojis();
    assert.equal(calls, 2);
  } finally {
    fetch.mock.restore();
  }
});
