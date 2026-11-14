import { expect, test } from "vite-plus/test";
import { createCommandService, defaultKeybindings } from "../../core/modules/ide/index.ts";
import {
  setZenAvailable,
  setZenMode,
  toggleZenMode,
  zenAvailable,
  zenMode,
} from "../common/utilities/zen-mode.ts";

test("zen state tracks availability, toggles cleanly and resets when workspace unmounts", () => {
  setZenAvailable(false);
  expect(zenAvailable.value).toBe(false);
  expect(zenMode.value).toBe(false);

  setZenAvailable(true);
  expect(zenAvailable.value).toBe(true);
  expect(toggleZenMode()).toBe(true);
  expect(zenMode.value).toBe(true);
  expect(toggleZenMode(true)).toBe(true);
  expect(toggleZenMode(false)).toBe(false);
  expect(zenMode.value).toBe(false);

  setZenMode(true);
  expect(zenMode.value).toBe(true);
  setZenAvailable(false);
  expect(zenAvailable.value).toBe(false);
  expect(zenMode.value).toBe(false);
});

test("Mod+Shift+Z triggers ide.workbench.zen.toggle even while focused in an input", async () => {
  setZenAvailable(false);
  const sdk = createCommandService(defaultKeybindings);
  const scope = sdk.createScope("workbench", () => ({ surface: "workbench" }));
  scope.registerCommand({
    id: "ide.workbench.zen.toggle",
    title: "Режим Zen",
    enabled: () => zenAvailable.value,
    run: (args) => ({ zen: toggleZenMode(args?.on) }),
  });

  // Outside a project workspace the command is disabled and the shortcut is inactive.
  expect(
    scope.resolveKeybinding({ key: "z", code: "KeyZ", ctrlKey: true, shiftKey: true }, true),
  ).toBe(undefined);

  setZenAvailable(true);
  const binding = scope.resolveKeybinding(
    { key: "Z", code: "KeyZ", ctrlKey: true, shiftKey: true },
    true,
  );
  expect(binding?.command).toBe("ide.workbench.zen.toggle");
  expect(scope.describe("ide.workbench.zen.toggle")?.shortcut).toBe("Ctrl+Shift+Z");

  await sdk.executeCommand(binding.command, binding.args, { scope: "workbench" });
  expect(zenMode.value).toBe(true);
  setZenAvailable(false);
});
