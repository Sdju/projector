<script setup lang="ts">
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
  <section class="panel">
    <div class="row">
      <p class="kicker">Qwen / OpenAI-compatible</p>
      <UiButton variant="ghost" @click="addProvider">+ провайдер</UiButton>
    </div>
    <p v-if="error" class="err">{{ error }}</p>
    <div class="list">
      <button
        v-for="item in providers"
        :key="item.id"
        type="button"
        class="item"
        :class="{ on: item.id === selected?.id }"
        @click="selectedId = item.id"
      >
        <span class="dot" :class="{ live: item.id === activeProviderId }" />
        <span>{{ item.name }}</span>
        <span class="meta">{{ item.model || "без модели" }}</span>
      </button>
    </div>

    <div v-if="selected" class="form">
      <UiField label="имя">
        <input
          :value="selected.name"
          @input="patchProvider(selected.id, { name: ($event.target as HTMLInputElement).value })"
        />
      </UiField>
      <UiField label="url">
        <input
          :value="selected.url"
          spellcheck="false"
          placeholder="https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
          @input="patchProvider(selected.id, { url: ($event.target as HTMLInputElement).value })"
        />
      </UiField>
      <UiField label="модель">
        <input
          :value="selected.model"
          spellcheck="false"
          placeholder="qwen3.8-flash"
          @input="patchProvider(selected.id, { model: ($event.target as HTMLInputElement).value })"
        />
      </UiField>
      <UiField label="api key">
        <input
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
      <div class="row">
        <UiButton
          variant="chip"
          :disabled="selected.id === activeProviderId"
          @click="setActive(selected.id)"
        >
          активный
        </UiButton>
        <UiButton variant="danger" @click="removeProvider(selected.id)">удалить</UiButton>
        <UiButton variant="solid" :disabled="saving" @click="save">
          {{ saving ? "…" : "сохранить" }}
        </UiButton>
      </div>
    </div>
  </section>
</template>

<style scoped>
.panel {
  display: grid;
  gap: var(--sp-4);
}

.kicker {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-xs);
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  align-items: center;
  justify-content: space-between;
}

.list {
  display: grid;
  gap: var(--sp-2);
}

.item {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  width: 100%;
  padding: var(--sp-2) 0;
  border-bottom: 1px solid var(--line);
  text-align: left;
}

.item.on span:nth-child(2) {
  color: var(--text);
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: var(--r-full);
  background: var(--faint);
}

.dot.live {
  background: var(--run);
}

.meta {
  margin-left: auto;
  color: var(--muted);
  font-family: var(--mono);
  font-size: var(--fs-xs);
}

.form {
  display: grid;
  gap: var(--sp-4);
}

.err {
  margin: 0;
  font-size: var(--fs-xs);
}

.err {
  color: var(--err);
}
</style>
