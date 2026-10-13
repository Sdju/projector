<script setup lang="ts">
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiActionRow from "../../../common/ui/UiActionRow.vue";
import UiStatusDot from "../../../common/ui/UiStatusDot.vue";
import UiControl from "../../../common/ui/UiControl.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiFormGrid from "../../../common/ui/UiFormGrid.vue";

import UiHint from "../../../common/ui/UiHint.vue";
import { computed, onMounted, ref } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiField from "../../../common/ui/UiField.vue";
import { useProviders } from "../model/store.ts";

const {
  providers,
  activeProviderId,
  error,
  saving,
  keyDrafts,
  load,
  save,
  setActive,
  addProvider,
  removeProvider,
  setKeyDraft,
  patchProvider,
} = useProviders();
const selectedId = ref<string | null>(null);
const selected = computed(
  () => providers.value.find((item) => item.id === selectedId.value) ?? providers.value[0] ?? null,
);

onMounted(async () => {
  await load();
  selectedId.value = activeProviderId.value ?? providers.value[0]?.id ?? null;
});

function keyDraft(): string {
  if (!selected.value) return "";
  return keyDrafts.value[selected.value.id] ?? "";
}
</script>

<template>
  <UiStack as="section" :gap="4">
    <UiInline wrap justify="between">
      <p class="kicker">OpenAI-compatible API</p>
      <UiButton @click="addProvider">+ провайдер</UiButton>
    </UiInline>
    <UiMessage v-if="error" tone="danger" size="xs" flush role="alert">{{ error }}</UiMessage>
    <UiStack :gap="2">
      <UiActionRow
        v-for="item in providers"
        :key="item.id"
        type="button"
        class="item"
        interaction="selection"
        radius="none"
        :gap="2"
        padding="var(--sp-2) 0"
        :class="{ on: item.id === selected?.id }"
        @click="selectedId = item.id"
      >
        <UiStatusDot class="dot" :tone="item.id === activeProviderId ? 'success' : 'faint'" />
        <span>{{ item.name }}</span>
        <span class="meta">{{ item.model || "без модели" }}</span>
      </UiActionRow>
    </UiStack>

    <UiStack v-if="selected" class="form" :gap="4">
      <UiFormGrid>
        <UiField v-slot="{ control }" label="имя">
          <UiControl
            v-bind="control"
            aria-label="Имя провайдера"
            :value="selected.name"
            @input="patchProvider(selected.id, { name: ($event.target as HTMLInputElement).value })"
          />
        </UiField>
        <UiField v-slot="{ control }" label="модель">
          <UiControl
            v-bind="control"
            aria-label="Модель"
            :value="selected.model"
            spellcheck="false"
            placeholder="qwen3.8-flash"
            @input="
              patchProvider(selected.id, { model: ($event.target as HTMLInputElement).value })
            "
          />
        </UiField>
      </UiFormGrid>
      <UiField v-slot="{ control }" label="url">
        <UiControl
          v-bind="control"
          aria-label="URL API"
          :value="selected.url"
          spellcheck="false"
          placeholder="https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
          @input="patchProvider(selected.id, { url: ($event.target as HTMLInputElement).value })"
        />
      </UiField>
      <UiField v-slot="{ control }" label="api key">
        <UiControl
          v-bind="control"
          aria-label="API key"
          :value="keyDraft()"
          type="password"
          autocomplete="off"
          :placeholder="
            selected.hasApiKey ? 'ключ сохранён — введите чтобы заменить' : 'DASHSCOPE / QWENCLOUD'
          "
          @input="setKeyDraft(selected.id, ($event.target as HTMLInputElement).value)"
        />
      </UiField>
      <UiHint>
        Ключ шифруется на диске (AES). Можно задать DASHSCOPE_API_KEY / OPENAI_URL в окружении.
      </UiHint>
      <UiInline wrap justify="between">
        <UiButton
          appearance="outline"
          tone="muted"
          shape="chip"
          :disabled="selected.id === activeProviderId"
          @click="setActive(selected.id)"
        >
          активный
        </UiButton>
        <UiButton tone="danger" @click="removeProvider(selected.id)">удалить</UiButton>
        <UiButton appearance="solid" :disabled="saving" @click="save">
          {{ saving ? "…" : "сохранить" }}
        </UiButton>
      </UiInline>
    </UiStack>
  </UiStack>
</template>

<style scoped>
.kicker {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-xs);
}

.item {
  border-bottom: 1px solid var(--line);
}

.item.on span:nth-child(2) {
  color: var(--text);
}

.meta {
  margin-left: auto;
  color: var(--muted);
  font-family: var(--mono);
  font-size: var(--fs-xs);
}

.item span:not(.dot) {
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
