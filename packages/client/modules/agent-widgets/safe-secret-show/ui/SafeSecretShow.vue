<script setup lang="ts">
import { inject, ref } from "vue";
import UiButton from "../../../../common/ui/UiButton.vue";
import UiCard from "../../../../common/ui/UiCard.vue";
import UiInline from "../../../../common/ui/UiInline.vue";
import UiSecretValue from "../../../../common/ui/UiSecretValue.vue";
import { widgetProjectKey } from "../../../widget-runtime/index.ts";
import IconKey from "~icons/lucide/key-round";

const props = defineProps<{ script: string; label?: string; comment?: string }>();

const projectId = inject(widgetProjectKey, undefined);
const secret = ref("");
const error = ref("");
const detail = ref("");
const loading = ref(false);

async function load(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  detail.value = "";
  try {
    const response = await fetch("/api/agent/secret-show/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        script: props.script,
        ...(props.label ? { label: props.label } : {}),
        ...(props.comment ? { comment: props.comment } : {}),
        ...(projectId?.value ? { projectId: projectId.value } : {}),
      }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      secret?: unknown;
      error?: unknown;
      detail?: unknown;
    };
    if (!response.ok) {
      detail.value = typeof data.detail === "string" ? data.detail : "";
      throw new Error(typeof data.error === "string" ? data.error : "Секрет недоступен");
    }
    if (typeof data.secret !== "string" || !data.secret) throw new Error("Сервер не вернул секрет");
    secret.value = data.secret;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Не удалось получить секрет";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <UiCard as="section" tone="warning" density="notice" class="secret-widget">
    <UiInline as="header" align="center" justify="normal">
      <IconKey aria-hidden="true" />
      <span class="title">{{ label || "Секрет" }}</span>
    </UiInline>
    <p v-if="comment" class="comment">{{ comment }}</p>
    <p class="note">Секрет не попадает в чат и к агенту.</p>
    <UiSecretValue v-if="secret" :value="secret" :label="label || 'Секрет'" />
    <template v-else>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <pre v-if="detail" class="detail">{{ detail }}</pre>
      <details class="command">
        <summary>Команда</summary>
        <pre>{{ script }}</pre>
      </details>
      <UiButton
        type="button"
        size="sm"
        appearance="solid"
        :busy="loading"
        :disabled="!script.trim()"
        @click="load"
      >
        {{ error ? "Повторить" : "Показать секрет" }}
      </UiButton>
    </template>
  </UiCard>
</template>

<style scoped>
.secret-widget {
  gap: var(--sp-3);
  font-size: var(--fs-md);
  line-height: 1.5;
}
header {
  min-width: 0;
}
header svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--warn);
}
.title {
  min-width: 0;
  overflow-wrap: anywhere;
  font-weight: 600;
}
.comment,
.note {
  margin: 0;
  font-size: var(--fs-sm);
  overflow-wrap: anywhere;
}
.comment {
  color: var(--text-2);
}
.note {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.command {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.command summary {
  cursor: pointer;
}
.command pre,
.detail {
  margin: var(--sp-2) 0 0;
  padding: var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg-sunken);
  color: var(--text-2);
  overflow-x: auto;
  white-space: pre-wrap;
}
.detail {
  margin: 0;
  border-color: color-mix(in srgb, var(--err) 40%, var(--line));
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.error {
  margin: 0;
  color: var(--err);
  font-size: var(--fs-sm);
  overflow-wrap: anywhere;
}
</style>
