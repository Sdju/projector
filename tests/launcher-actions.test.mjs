import { expect, test, vi } from "vite-plus/test";
import { createLauncherModel, resolveLauncherAction } from "../core/modules/launcher/index.ts";

for (const kind of ["github", "gitlab", "directory"]) {
  test(`${kind} does not synthesize an unsupported favorite action`, async () => {
    const client = { detail: vi.fn(async () => ({ actions: [{ id: "open", title: "Open" }] })) };
    expect(await resolveLauncherAction(client, { id: kind, kind }, "favorite")).toBeUndefined();
    expect(client.detail).toHaveBeenCalledWith(kind);
  });
}
for (const kind of ["application", "project"]) {
  test(`${kind} favorite comes from the full detail rather than primary search actions`, async () => {
    const favorite = { id: "favorite", title: "Remove from favorites" };
    const client = { detail: vi.fn(async () => ({ actions: [favorite] })) };
    const item = { id: kind, kind, actions: [{ id: "open", title: "Open" }] };
    expect(await resolveLauncherAction(client, item, "favorite")).toBe(favorite);
  });
}
test("detail failures propagate and an already loaded detail is reused", async () => {
  const client = {
    detail: vi.fn(async () => {
      throw new Error("Unavailable");
    }),
  };
  await expect(resolveLauncherAction(client, { id: "test" }, "favorite")).rejects.toThrow(
    "Unavailable",
  );
  const favorite = { id: "favorite", title: "Favorite" };
  expect(
    await resolveLauncherAction(client, { id: "test" }, "favorite", { actions: [favorite] }),
  ).toBe(favorite);
  expect(client.detail).toHaveBeenCalledTimes(1);
});

test("favorite retries full detail after entering the card failed", async () => {
  const primary = { id: "launch", title: "Launch" };
  const favorite = { id: "favorite", title: "Favorite" };
  const item = { id: "app", kind: "application", actions: [primary] };
  const client = {
    search: async () => ({ items: [item] }),
    launch: vi.fn(async () => ({ ok: true })),
    detail: vi
      .fn()
      .mockRejectedValueOnce(new Error("Unavailable"))
      .mockResolvedValue({ actions: [primary, favorite] }),
  };
  const model = createLauncherModel(client);
  try {
    await model.search();
    await model.enter(item);
    expect(model.state.detailLoading).toBe(false);
    expect(model.state.detailReady).toBe(false);
    expect(model.state.detail.actions).toStrictEqual([primary]);
    expect(
      await resolveLauncherAction(
        client,
        item,
        "favorite",
        model.state.detailReady ? model.state.detail : null,
      ),
    ).toBe(favorite);
    expect(client.detail).toHaveBeenCalledTimes(2);
    await model.enter(item);
    expect(model.state.detailReady).toBe(true);
    expect(
      await resolveLauncherAction(
        client,
        item,
        "favorite",
        model.state.detailReady ? model.state.detail : null,
      ),
    ).toBe(favorite);
    expect(client.detail).toHaveBeenCalledTimes(3);
    model.leave();
    expect(model.state.detailReady).toBe(false);
  } finally {
    model.dispose();
  }
});
