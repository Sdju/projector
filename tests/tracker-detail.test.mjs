import assert from "node:assert/strict";
import { test } from "node:test";
import { effectScope, nextTick, ref } from "vue";
import { registerWorkspaceProfile } from "../src/modules/workspace-api/index.ts";
import { useTrackerDetail } from "../src/modules/workspace/modules/viewers/lib/tracker-detail.ts";

for (const action of ["issue", "pull", "discussion"]) {
  test(`${action} detail ignores stale replies and errors, resets and disposes`, async (t) => {
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
    t.after(() => scope.stop());
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
    assert.equal(state.loading.value, true);
    assert.equal(calls[0].kind, action);
    assert.deepEqual(calls[0].params, { number: "1" });
    calls[0].resolve({ title: "first" });
    await settle();
    assert.deepEqual(state.detail.value, { title: "first" });
    assert.equal(state.loading.value, false);

    number.value = 2;
    await nextTick();
    assert.equal(state.detail.value, undefined);
    assert.equal(state.loading.value, true);
    assert.equal(calls[0].signal.aborted, true);
    number.value = 3;
    await nextTick();
    assert.equal(calls[1].signal.aborted, true);
    calls[1].resolve({ title: "stale" });
    await settle();
    assert.equal(state.detail.value, undefined);
    assert.equal(state.loading.value, true);
    calls[2].resolve({ title: "latest" });
    await settle();
    assert.deepEqual(state.detail.value, { title: "latest" });

    number.value = 4;
    await nextTick();
    projectId.value = "tracker-second";
    await nextTick();
    assert.equal(calls[4].projectId, "tracker-second");
    assert.deepEqual(calls[4].params, { number: "4" });
    calls[3].reject(new Error("stale failure"));
    await settle();
    assert.equal(state.error.value, "");
    assert.equal(state.loading.value, true);
    calls[4].reject(new Error("Provider failed"));
    await settle();
    assert.equal(state.error.value, "Provider failed");
    assert.equal(state.loading.value, false);

    number.value = 5;
    await nextTick();
    assert.equal(state.error.value, "");
    calls[5].reject("non-Error failure");
    await settle();
    assert.equal(state.error.value, "Fallback");
    number.value = 6;
    await nextTick();
    scope.stop();
    assert.equal(calls[6].signal.aborted, true);
    calls[6].resolve({ title: "after disposal" });
    await settle();
    assert.equal(state.detail.value, undefined);
    assert.equal(state.error.value, "");
    // The disposed state is frozen; a late finally must not update it either.
    assert.equal(state.loading.value, true);
  });
}
