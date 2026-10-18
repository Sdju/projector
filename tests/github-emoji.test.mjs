import { expect, test, vi } from "vite-plus/test";
import { loadGithubEmojis, splitEmoji } from "../src/common/utilities/github-emoji.ts";

const map = {
  tada: "https://img/tada.png",
  smile: "https://img/smile.png",
  "+1": "https://img/plus.png",
  constructor: undefined,
};

test("splitEmoji replaces known shortcodes and leaves the rest as written", () => {
  expect(splitEmoji("Ship :tada: now :nope: and :+1:", map)).toStrictEqual([
    "Ship ",
    { name: "tada", url: "https://img/tada.png" },
    " now :nope: and ",
    { name: "+1", url: "https://img/plus.png" },
  ]);
  expect(splitEmoji("12:30:45", map)).toStrictEqual(["12:30:45"]);
  // Object prototype keys are not emoji.
  expect(splitEmoji(":constructor: :toString:", map)).toStrictEqual([":constructor: :toString:"]);
  expect(splitEmoji(":TADA:", map)).toStrictEqual([{ name: "tada", url: "https://img/tada.png" }]);
});

test("the emoji list is loaded once and a failed load can be retried", async () => {
  let calls = 0;
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    calls++;
    return calls === 1 ? new Response("", { status: 500 }) : Response.json(map);
  });
  try {
    expect(await loadGithubEmojis()).toStrictEqual({});
    expect((await loadGithubEmojis()).tada).toBe("https://img/tada.png");
    await loadGithubEmojis();
    expect(calls).toBe(2);
  } finally {
    fetch.mockRestore();
  }
});
