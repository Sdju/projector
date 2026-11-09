import { expect, test, vi } from "vite-plus/test";
import { effectScope, ref } from "vue";

vi.mock("../packages/client/modules/agent-core/api/client.ts", () => ({
  loadSessionTurns: vi.fn(),
}));

const { loadSessionTurns } = await import("../packages/client/modules/agent-core/api/client.ts");
const { useTaskTurns } = await import("../packages/client/modules/agent-turns/model/task-turns.ts");

test("a task session is read only after Lens asks and refreshed while the task runs", async () => {
  vi.useFakeTimers();
  loadSessionTurns.mockReset();
  loadSessionTurns.mockResolvedValue([{ id: "t1", role: "assistant", text: "ищу", tools: [] }]);
  const session = ref("session-1");
  const running = ref(true);
  const scope = effectScope();
  const task = scope.run(() =>
    useTaskTurns({
      backend: () => "codex",
      projectId: () => "project",
      session: () => session.value,
      running: () => running.value,
      intervalMs: 1_000,
    }),
  );
  try {
    // Closed Lens: no request at all.
    expect(loadSessionTurns).not.toHaveBeenCalled();
    await task.start();
    expect(loadSessionTurns).toHaveBeenCalledTimes(1);
    expect(loadSessionTurns).toHaveBeenCalledWith("codex", "project", "session-1");
    expect(task.turns.value[0].text).toBe("ищу");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(loadSessionTurns).toHaveBeenCalledTimes(2);
    // The end of the task is read once more, then the timer stops.
    running.value = false;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(loadSessionTurns).toHaveBeenCalledTimes(3);

    // A finished task can still be reopened by hand; the timer stays quiet.
    await task.load();
    expect(loadSessionTurns).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(loadSessionTurns).toHaveBeenCalledTimes(4);

    task.stop();
    running.value = true;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(loadSessionTurns).toHaveBeenCalledTimes(4);
  } finally {
    scope.stop();
    vi.useRealTimers();
  }
});
