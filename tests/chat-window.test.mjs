import { expect, test } from "vite-plus/test";
import { nextTick, ref } from "vue";
import { useChatWindow } from "../src/modules/agent/model/chat-window.ts";

const chat = (requests) =>
  Array.from({ length: requests * 2 }, (_, i) => ({
    id: `t${i}`,
    role: i % 2 ? "assistant" : "user",
    text: "",
    tools: [],
  }));
/** A scrolling element whose content grows by 100px per mounted turn. */
const element = (turns, window) => ({
  clientHeight: 500,
  scrollTop: 0,
  get scrollHeight() {
    return window.shown.value.length * 100;
  },
});

function setup(requests, waiting = false) {
  const turns = ref(chat(requests));
  const log = ref();
  const settled = [];
  const state = { waiting: ref(waiting) };
  const window = useChatWindow(turns, log, () => settled.push(log.value.scrollTop), state.waiting);
  log.value = element(turns, window);
  return { turns, log, window, settled, ...state };
}

test("a long chat mounts the last five requests and the rest on demand", async () => {
  const { window, log, settled } = setup(23);
  expect(window.shown.value).toHaveLength(10);
  expect(window.shown.value[0].role).toBe("user");
  expect(window.shown.value[0].id).toBe("t36");
  expect(window.hidden.value).toBe(18);
  expect(window.firstShown.value).toBe(36);

  // Older requests come in portions of five; what is on screen stays in place.
  log.value.scrollTop = 120;
  expect(await window.loadEarlier()).toBe(true);
  expect(window.hidden.value).toBe(13);
  expect(log.value.scrollTop).toBe(120 + 1000);
  expect(settled).toHaveLength(1);

  // Near the top a portion is added; once there is room above, nothing more is mounted.
  log.value.scrollTop = 0;
  await window.topUp();
  expect(window.hidden.value).toBe(8);
  await window.topUp();
  expect(window.hidden.value).toBe(8);
  while (window.hidden.value) {
    log.value.scrollTop = 0;
    await window.topUp();
  }
  expect(window.shown.value).toHaveLength(46);
  expect(await window.loadEarlier()).toBe(false);
});

test("a short chat is shown whole, and a short window is filled from above", async () => {
  const short = setup(3);
  expect(short.window.hidden.value).toBe(0);
  expect(short.window.shown.value).toHaveLength(6);

  const long = setup(30);
  long.log.value.scrollTop = 5000;
  // 5 requests are 1000px, the view is 500px: 400px of room is not enough, so it fills.
  long.log.value.clientHeight = 900;
  await long.window.topUp(true);
  expect(long.window.shown.value.length).toBeGreaterThan(10);
});

test("nothing is mounted while the history is still being fetched", async () => {
  const { window, waiting, log } = setup(20, true);
  log.value.clientHeight = 900;
  expect(await window.loadEarlier()).toBe(false);
  expect(window.hidden.value).toBe(15);
  waiting.value = false;
  await nextTick();
  await nextTick();
  // The view is not scrollable yet: the window grows until there is room.
  expect(window.hidden.value).toBeLessThan(15);
});

test("what the user sends joins the window and another chat starts over", async () => {
  const { turns, window } = setup(12);
  const top = window.shown.value[0].id;
  turns.value = [
    ...turns.value,
    { id: "u-new", role: "user", text: "", tools: [] },
    { id: "a-new", role: "assistant", text: "", tools: [] },
  ];
  await nextTick();
  // The top the user is reading does not move when a request is added at the bottom.
  expect(window.shown.value[0].id).toBe(top);
  expect(window.shown.value).toHaveLength(12);

  turns.value = chat(12).map((turn) => ({ ...turn, id: `other-${turn.id}` }));
  await nextTick();
  expect(window.shown.value).toHaveLength(10);
});
