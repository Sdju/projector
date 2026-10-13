import { expect, test } from "vite-plus/test";
import { clearAgentSession } from "../core/modules/os/index.ts";

test("a server started inside a Claude Code session does not pass the session on", () => {
  const env = {
    CLAUDECODE: "1",
    CLAUDE_CODE_CHILD_SESSION: "1",
    CLAUDE_CODE_SESSION_ID: "abc",
    CLAUDE_CODE_MESSAGING_TOKEN: "secret",
    CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/s.sock",
    CLAUDE_PID: "42",
    PATH: "/usr/bin",
  };
  expect(clearAgentSession(env).sort()).toEqual([
    "CLAUDECODE",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_PID",
  ]);
  expect(env).toEqual({ PATH: "/usr/bin" });
});

test("user configuration of Claude Code is kept and a clean environment is untouched", () => {
  const env = {
    CLAUDE_CODE_USE_BEDROCK: "1",
    CLAUDE_CODE_OAUTH_TOKEN: "t",
    CLAUDE_EFFORT: "high",
    HOME: "/home/u",
  };
  expect(clearAgentSession(env)).toEqual([]);
  expect(env).toEqual({
    CLAUDE_CODE_USE_BEDROCK: "1",
    CLAUDE_CODE_OAUTH_TOKEN: "t",
    CLAUDE_EFFORT: "high",
    HOME: "/home/u",
  });
});

test("the real process environment is cleaned in place", () => {
  process.env.CLAUDE_CODE_CHILD_SESSION = "1";
  clearAgentSession();
  expect(process.env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined();
});
