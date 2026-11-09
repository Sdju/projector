import { expect, test, vi } from "vite-plus/test";
import {
  JUDGE_DEFAULTS,
  judgeAllows,
  normalizeJudgeOverride,
  normalizeJudgeSettings,
  resolveJudgeSettings,
} from "../packages/core/modules/agent-judge/index.ts";
import {
  createJudgedApproval,
  judgeFallback,
  parseJudgeVerdict,
} from "../packages/server/modules/judge/index.ts";
import {
  canRememberPermission,
  permissionRiskClass,
  permissionTone,
} from "../packages/client/modules/agent-turns/lib/permission-risk.ts";

const verdict = (score, confidence = "high") => ({
  score,
  label: ["", "безопасно", "низкий", "умеренный", "высокий", "критический"][score],
  reason: "понятная причина",
  confidence,
});

test("Judge parses a verdict and treats an unreadable answer as high risk", () => {
  expect(
    parseJudgeVerdict(
      '{"score":2,"confidence":"high","reason":"Правка внутри проекта","effect":"файл src/a.ts"}',
    ),
  ).toEqual({
    score: 2,
    label: "низкий",
    reason: "Правка внутри проекта",
    confidence: "high",
    effect: "файл src/a.ts",
  });
  expect(parseJudgeVerdict("не JSON").score).toBe(4);
  expect(parseJudgeVerdict("не JSON").confidence).toBe("low");
  expect(parseJudgeVerdict('{"score":9,"confidence":"high","reason":"x"}')).toMatchObject({
    score: 4,
    confidence: "low",
  });
});

test("Judge automation respects the score, confidence and the auto switch", () => {
  const settings = { ...JUDGE_DEFAULTS, auto: true, maxRisk: 1, confidence: "high-medium" };
  expect(judgeAllows(settings, verdict(1, "medium"))).toBe(true);
  expect(judgeAllows(settings, verdict(1, "low"))).toBe(false);
  expect(judgeAllows(settings, verdict(2, "high"))).toBe(false);
  expect(judgeAllows({ ...settings, auto: false }, verdict(1))).toBe(false);
  expect(judgeAllows({ ...settings, maxRisk: 2 }, verdict(2))).toBe(true);
  expect(judgeAllows({ ...settings, confidence: "high" }, verdict(1, "medium"))).toBe(false);
});

test("Judge settings keep automatic scores at 3 or lower and merges a chat override", () => {
  expect(normalizeJudgeSettings({ maxRisk: 4 }).maxRisk).toBe(JUDGE_DEFAULTS.maxRisk);
  expect(normalizeJudgeOverride({ maxRisk: 9, show: false })).toEqual({ show: false });
  expect(normalizeJudgeOverride({})).toBeUndefined();
  expect(
    resolveJudgeSettings(
      { ...JUDGE_DEFAULTS, maxRisk: 2, auto: true },
      { maxRisk: 1, confidence: "high" },
    ),
  ).toMatchObject({ maxRisk: 1, confidence: "high", auto: true });
});

test("Judge allows a low-risk action without a card and explains it in the chat", async () => {
  const approve = vi.fn(async () => false);
  const emit = vi.fn();
  const judged = createJudgedApproval({
    approve,
    emit,
    settings: { ...JUDGE_DEFAULTS, auto: true, maxRisk: 1, confidence: "high-medium" },
    judge: async () => verdict(1, "high"),
  });
  await expect(judged({ tool: "bash", input: { command: "ls" } })).resolves.toBe(true);
  expect(approve).not.toHaveBeenCalled();
  expect(emit).toHaveBeenCalledWith(
    "judge",
    expect.objectContaining({ tool: "bash", decision: "auto" }),
  );
});

test("Judge shows the score in the card and never automates a failure", async () => {
  const approve = vi.fn(async () => "always");
  const emit = vi.fn();
  const judged = createJudgedApproval({
    approve,
    emit,
    settings: { ...JUDGE_DEFAULTS, auto: true, maxRisk: 3, confidence: "high-medium" },
    judge: async () => judgeFallback(),
  });
  await expect(judged({ tool: "bash", input: { command: "rm -rf /" } })).resolves.toBe("always");
  expect(approve).toHaveBeenCalledWith(
    expect.objectContaining({ judge: expect.objectContaining({ score: 4, confidence: "low" }) }),
  );
  expect(emit).not.toHaveBeenCalled();
});

test("The card tone follows the score and never remembers a high-risk permission", () => {
  expect(permissionTone()).toBe("warning");
  expect(permissionTone(verdict(1))).toBe("neutral");
  expect(permissionTone(verdict(3))).toBe("warning");
  expect(permissionTone(verdict(4))).toBe("danger");
  expect(permissionTone(verdict(5))).toBe("danger");
  expect(permissionRiskClass()).toBe("risk-0");
  expect(permissionRiskClass(verdict(3))).toBe("risk-3");
  expect(canRememberPermission({ persistent: true })).toBe(true);
  expect(canRememberPermission({ persistent: false, judge: verdict(1) })).toBe(false);
  expect(canRememberPermission({ persistent: true, judge: verdict(3) })).toBe(true);
  expect(canRememberPermission({ persistent: true, judge: verdict(4) })).toBe(false);
});

test("Judge does not spend a request when both display and automation are off", async () => {
  const approve = vi.fn(async () => true);
  const judge = vi.fn(async () => verdict(1));
  const judged = createJudgedApproval({
    approve,
    emit: vi.fn(),
    settings: { ...JUDGE_DEFAULTS, show: false, auto: false },
    judge,
  });
  await expect(judged({ tool: "bash", input: {} })).resolves.toBe(true);
  expect(judge).not.toHaveBeenCalled();
  expect(approve).toHaveBeenCalledOnce();
});
