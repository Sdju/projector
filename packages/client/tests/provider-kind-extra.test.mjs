import { expect, test } from "vite-plus/test";
import { providerPreset } from "../modules/provider/model/presets.ts";
import { providerKindExtra, registerProviderKindExtra } from "../modules/provider/index.ts";
import { registerBuiltinProviderExtras } from "../app/providers.ts";

test("provider kinds bring their own preset and details without the shared panel naming them", () => {
  expect(providerKindExtra("deepseek")).toBeUndefined();
  registerBuiltinProviderExtras();
  expect(providerPreset("qwencloud")).toMatchObject({
    label: "Qwen Cloud",
    url: "",
    model: "qwen3.8-flash",
  });
  expect(providerPreset("deepseek").label).toBe("DeepSeek");
  const extra = providerKindExtra("qwencloud");
  expect(extra?.kind).toBe("qwencloud");
  expect(extra?.component).toBeTruthy();

  const replacement = { kind: "qwencloud", component: {} };
  registerProviderKindExtra(replacement);
  expect(providerKindExtra("qwencloud")).toBe(replacement);
});
