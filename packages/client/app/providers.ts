import { registerProviderKindExtra, registerProviderPreset } from "../modules/provider/index.ts";
import { qwenCloudPreset, qwenCloudProviderExtra } from "../modules/provider-qwencloud/index.ts";

/**
 * Виды провайдеров со своим пресетом и частью карточки. Общая панель перечисляет всех одинаково,
 * а данные и подробности вида приходят из его модуля.
 */
export function registerBuiltinProviderExtras(): void {
  registerProviderPreset("qwencloud", qwenCloudPreset);
  registerProviderKindExtra(qwenCloudProviderExtra);
}
