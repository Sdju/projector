import { defineWidget } from "../../widget-catalog/index.ts";

export const safeSecretShowWidget = defineWidget({
  name: "SafeSecretShow",
  group: "data",
  summary:
    "секрет от агента: показывает пользователю значение, которое вернёт скрипт, не попадая ни в чат, ни к агенту",
  props: {
    script: {
      type: "string",
      description: "shell-команда, чей stdout — секрет; выполняется на машине пользователя",
      required: true,
    },
    label: { type: "string", description: "название секрета в панели" },
    comment: { type: "string", description: "комментарий агента пользователю" },
  },
  special: true,
  notes: [
    "Секрет не попадает в ответ, историю чата и контекст агента: скрипт выполняется на сервере, а значение показывается только в браузере пользователя.",
    "Скрипт запускается только по нажатию «Показать секрет»; команда видна под кнопкой. Значение хранится лишь в открытом окне.",
  ],
  example:
    '<SafeSecretShow script="cat ~/.ssh/id_ed25519" label="Приватный ключ SSH" comment="Скопируйте ключ в сервис." />',
});
