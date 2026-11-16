import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  AGENT_TURN_END_EVENT,
  announceAgentTurnEnd,
  onAgentTurnEnd,
} from "../modules/agent-core/lib/turn-end.ts";

afterEach(() => vi.unstubAllGlobals());

function page() {
  const target = new EventTarget();
  vi.stubGlobal("window", target);
  return target;
}

test("an answer of a project tells the page that it ended", () => {
  const target = page();
  const seen = [];
  target.addEventListener(AGENT_TURN_END_EVENT, (event) => seen.push(event.detail));
  announceAgentTurnEnd("project-a");
  expect(seen).toStrictEqual([{ projectId: "project-a" }]);
});

test("a workspace reloads only for its own project and stops after unsubscribe", () => {
  page();
  let reloads = 0;
  const release = onAgentTurnEnd("project-a", () => reloads++);
  announceAgentTurnEnd("project-b");
  expect(reloads).toBe(0);
  announceAgentTurnEnd("project-a");
  expect(reloads).toBe(1);
  release();
  announceAgentTurnEnd("project-a");
  expect(reloads).toBe(1);
});

test("a chat without a project announces nothing", () => {
  const target = page();
  const seen = [];
  target.addEventListener(AGENT_TURN_END_EVENT, () => seen.push(1));
  announceAgentTurnEnd("");
  expect(seen).toStrictEqual([]);
});
