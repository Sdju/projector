import { expect, onTestFinished, test } from "vite-plus/test";
import { effectScope, nextTick, ref } from "vue";
import { registerWorkspaceProfile } from "../src/modules/workspace-api/index.ts";
import { useTrackerDetail } from "../src/modules/workspace/modules/viewers/lib/tracker-detail.ts";

for (const action of ["issue", "pull", "discussion"]) {
  test(`${action} detail ignores stale replies and errors, resets and disposes`, async () => {
    const calls = [];
    const provider = (projectId) => ({
      read(kind, params, signal) {
        return new Promise((resolve, reject) => {
          calls.push({ projectId, kind, params, signal, resolve, reject });
        });
      },
    });
    for (const id of ["tracker-first", "tracker-second"]) {
      const read = provider(id);
      registerWorkspaceProfile(id, {
        id,
        providers: {
          files: { ...read, assetUrl: () => "" },
          issues: read,
          pulls: read,
          discussions: read,
        },
        features: {},
        layout: "editor",
      });
    }
    const scope = effectScope();
    onTestFinished(() => scope.stop());
    const projectId = ref("tracker-first");
    const number = ref(1);
    const state = scope.run(() =>
      useTrackerDetail(
        () => projectId.value,
        () => number.value,
        action,
        "Fallback",
      ),
    );
    const settle = async () => {
      await Promise.resolve();
      await nextTick();
    };
    expect(state.loading.value).toBe(true);
    expect(calls[0].kind).toBe(action);
    expect(calls[0].params).toStrictEqual({ number: "1" });
    calls[0].resolve({ title: "first" });
    await settle();
    expect(state.detail.value).toStrictEqual({ title: "first" });
    expect(state.loading.value).toBe(false);

    number.value = 2;
    await nextTick();
    expect(state.detail.value).toBe(undefined);
    expect(state.loading.value).toBe(true);
    expect(calls[0].signal.aborted).toBe(true);
    number.value = 3;
    await nextTick();
    expect(calls[1].signal.aborted).toBe(true);
    calls[1].resolve({ title: "stale" });
    await settle();
    expect(state.detail.value).toBe(undefined);
    expect(state.loading.value).toBe(true);
    calls[2].resolve({ title: "latest" });
    await settle();
    expect(state.detail.value).toStrictEqual({ title: "latest" });

    number.value = 4;
    await nextTick();
    projectId.value = "tracker-second";
    await nextTick();
    expect(calls[4].projectId).toBe("tracker-second");
    expect(calls[4].params).toStrictEqual({ number: "4" });
    calls[3].reject(new Error("stale failure"));
    await settle();
    expect(state.error.value).toBe("");
    expect(state.loading.value).toBe(true);
    calls[4].reject(new Error("Provider failed"));
    await settle();
    expect(state.error.value).toBe("Provider failed");
    expect(state.loading.value).toBe(false);

    number.value = 5;
    await nextTick();
    expect(state.error.value).toBe("");
    calls[5].reject("non-Error failure");
    await settle();
    expect(state.error.value).toBe("Fallback");
    number.value = 6;
    await nextTick();
    scope.stop();
    expect(calls[6].signal.aborted).toBe(true);
    calls[6].resolve({ title: "after disposal" });
    await settle();
    expect(state.detail.value).toBe(undefined);
    expect(state.error.value).toBe("");
    // The disposed state is frozen; a late finally must not update it either.
    expect(state.loading.value).toBe(true);
  });
}
