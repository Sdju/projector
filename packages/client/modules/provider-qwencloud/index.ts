import { QWENCLOUD_URL_EXAMPLE } from "@ai-projector/core/modules/providers/index.ts";
import type { ProviderKindExtra, ProviderPreset } from "../provider/index.ts";
import QwenCloudDetails from "./ui/QwenCloudDetails.vue";

export { QwenCloudDetails };

/** Пресет без региона: адрес из консоли выбирает пользователь. */
export const qwenCloudPreset: ProviderPreset = {
  thinking: "qwen",
  label: "Qwen Cloud",
  name: "Qwen Cloud",
  url: "",
  urlPlaceholder: QWENCLOUD_URL_EXAMPLE,
  model: "qwen3.8-flash",
  keyPlaceholder: "sk-ws-… или sk-sp-… с home.qwencloud.com/api-keys",
  hint: "Вставьте адрес из консоли QwenCloud: https://{region}.maas.qwencloudapi.com/compatible-mode/v1. Ключ и регион должны совпадать; домен без региона обслуживает Singapore. Баланса по ключу API нет: расход и квоты читает CLI qwencloud.",
};

/** Регион и предупреждения QwenCloud живут рядом с видом, а не в общей карточке провайдера. */
export const qwenCloudProviderExtra: ProviderKindExtra = {
  kind: "qwencloud",
  component: QwenCloudDetails,
};
