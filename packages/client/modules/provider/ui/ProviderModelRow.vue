<script setup lang="ts">
import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";
import UiControl from "../../../common/ui/UiControl.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import {
  providerModelCapabilityTitle,
  providerModelKindOf,
  providerModelKindTitle,
} from "@ai-projector/core/modules/providers/index.ts";
import type { ModelPrice } from "../model/types.ts";
import {
  type ModelRow,
  capabilityIcon,
  modalityTitle,
  modalityIcon,
  kindIcon,
} from "../model/model-facts.ts";

defineProps<{ row: ModelRow }>();
const emit = defineEmits<{
  toggle: [on: boolean];
  rename: [alias: string];
  context: [value: string];
  thinking: [on: boolean];
  price: [field: keyof ModelPrice, value: string];
  applyCatalog: [];
}>();

const PRICE_FIELDS = [
  ["input", "вход"],
  ["output", "выход"],
  ["cacheRead", "из кэша"],
] as const;
</script>

<template>
  <div class="model-entry">
    <label class="row" :class="{ off: !row.on }">
      <UiControl
        type="checkbox"
        :aria-label="`Зарегистрировать ${row.id}`"
        :model-value="row.on"
        @update:model-value="emit('toggle', Boolean($event))"
      />
      <span class="mid" :title="row.info?.description">{{ row.id }}</span>
      <UiControl
        v-if="row.on"
        class="alias"
        mono
        :aria-label="`Имя модели ${row.id}`"
        :value="row.alias"
        :placeholder="row.id"
        spellcheck="false"
        @input="emit('rename', ($event.target as HTMLInputElement).value)"
      />
      <UiControl
        v-if="row.on"
        class="ctx"
        mono
        type="number"
        min="1000"
        step="1000"
        :aria-label="`Окно контекста ${row.id}, токенов`"
        :value="row.contextTokens"
        placeholder="окно, токенов"
        @input="emit('context', ($event.target as HTMLInputElement).value)"
      />
      <UiControl
        v-if="row.on"
        class="think"
        type="checkbox"
        title="Модель умеет размышлять: над строкой ввода агента появится переключатель"
        :aria-label="`Размышление ${row.id}`"
        :model-value="row.thinking !== false"
        @update:model-value="emit('thinking', Boolean($event))"
      />
      <span v-if="row.on" class="price">
        <span v-for="[field, label] in PRICE_FIELDS" :key="field" class="price-field">
          <span class="price-label">{{ label }}</span>
          <UiControl
            mono
            type="number"
            min="0"
            step="any"
            :aria-label="`Цена ${label} ${row.id}, за 1 млн токенов`"
            :value="row.price?.[field]"
            placeholder="—"
            @input="emit('price', field, ($event.target as HTMLInputElement).value)"
          />
        </span>
      </span>
      <UiInline v-if="row.facts" class="model-facts" wrap :gap="2">
        <span
          v-if="row.facts.kind !== 'chat'"
          class="model-kind"
          :title="providerModelKindTitle(row.facts.kind)"
          :aria-label="providerModelKindTitle(row.facts.kind)"
          role="img"
        >
          <ProjectorIcon :name="kindIcon(row.facts.kind)" />
          {{ providerModelKindTitle(row.facts.kind) }}
        </span>
        <span v-if="row.facts.input.length || row.facts.output.length" class="model-flow">
          <span
            v-for="item in row.facts.input"
            :key="`in-${item}`"
            class="provider-model-fact-icon"
            :title="modalityTitle('вход', item)"
            :aria-label="modalityTitle('вход', item)"
            role="img"
          >
            <ProjectorIcon :name="modalityIcon(item)" />
          </span>
          <ProjectorIcon
            v-if="row.facts.input.length && row.facts.output.length"
            name="arrow-right"
            class="flow-arrow"
            aria-hidden="true"
          />
          <span
            v-for="item in row.facts.output"
            :key="`out-${item}`"
            class="provider-model-fact-icon"
            :title="modalityTitle('выход', item)"
            :aria-label="modalityTitle('выход', item)"
            role="img"
          >
            <ProjectorIcon :name="modalityIcon(item)" />
          </span>
        </span>
        <span v-if="row.facts.context" class="fact-text">{{ row.facts.context }}</span>
        <span v-if="row.facts.price" class="fact-text">{{ row.facts.price }}</span>
        <span v-if="row.facts.priceNote" class="fact-text fact-note">{{
          row.facts.priceNote
        }}</span>
        <span
          v-for="item in row.facts.capabilities"
          :key="item"
          class="provider-model-fact-icon"
          :title="providerModelCapabilityTitle(item)"
          :aria-label="providerModelCapabilityTitle(item)"
          role="img"
        >
          <ProjectorIcon :name="capabilityIcon(item)" />
        </span>
      </UiInline>
    </label>
    <div v-if="row.on && row.info && (row.info.description || row.info.priceNote)" class="catalog">
      <p class="catalog-shape">
        <span class="catalog-kind">
          <ProjectorIcon :name="kindIcon(providerModelKindOf(row.info))" aria-hidden="true" />
          {{ providerModelKindTitle(providerModelKindOf(row.info)) }}
        </span>
        <span
          v-for="item in row.info.input ?? []"
          :key="`cin-${item}`"
          class="provider-model-fact-icon"
          :title="modalityTitle('вход', item)"
          :aria-label="modalityTitle('вход', item)"
          role="img"
        >
          <ProjectorIcon :name="modalityIcon(item)" />
        </span>
        <ProjectorIcon
          v-if="(row.info.input ?? []).length && (row.info.output ?? []).length"
          name="arrow-right"
          class="flow-arrow"
          aria-hidden="true"
        />
        <span
          v-for="item in row.info.output ?? []"
          :key="`cout-${item}`"
          class="provider-model-fact-icon"
          :title="modalityTitle('выход', item)"
          :aria-label="modalityTitle('выход', item)"
          role="img"
        >
          <ProjectorIcon :name="modalityIcon(item)" />
        </span>
      </p>
      <p v-if="row.info.description" class="catalog-description">
        {{ row.info.description }}
      </p>
      <p v-if="row.info.priceNote" class="catalog-note">{{ row.info.priceNote }}</p>
      <p v-if="row.info.source" class="catalog-source">
        <a :href="row.info.source" target="_blank" rel="noreferrer">каталог провайдера</a>
        <template v-if="row.info.checkedAt"> · проверено {{ row.info.checkedAt }}</template>
        <template v-if="row.info.deprecated"> · модель устарела</template>
        <template v-if="row.on && (row.info.price || row.info.contextTokens)">
          ·
          <button type="button" class="catalog-fill" @click="emit('applyCatalog')">
            заполнить поля
          </button>
        </template>
      </p>
    </div>
  </div>
</template>

<style scoped>
.row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--sp-1) var(--sp-2);
  align-items: center;
  padding: var(--sp-1) 0;
  cursor: pointer;
}

.row.off .mid {
  color: var(--muted);
}

.mid {
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: var(--mono);
  font-size: var(--fs-xs);
}

.alias,
.ctx,
.think {
  grid-column: 2;
}

.price {
  grid-column: 2 / -1;
  display: flex;
  gap: var(--sp-2);
}

.price-field {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--sp-1);
  min-width: 0;
}
.model-entry {
  display: grid;
}
.model-facts {
  grid-column: 2 / -1;
  color: var(--faint);
  font-size: var(--fs-xs);
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.model-facts,
.catalog-shape {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.model-kind,
.catalog-kind {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border-radius: var(--r-sm);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--text-2);
  font-weight: 600;
}
.model-flow {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.model-kind .projector-icon,
.catalog-kind .projector-icon {
  width: 15px;
  height: 15px;
}
.flow-arrow {
  width: 15px;
  height: 15px;
  color: var(--faint);
}
.provider-model-fact-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  color: var(--text-2);
}
.provider-model-fact-icon :deep(.projector-icon) {
  width: 15px;
  height: 15px;
}
.fact-text {
  color: var(--faint);
  font-variant-numeric: tabular-nums;
}
.fact-note {
  max-width: 100%;
}
.catalog {
  display: grid;
  gap: 2px;
  padding: 0 0 var(--sp-2) var(--sp-5);
}
.catalog-description,
.catalog-note,
.catalog-source {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: 1.45;
}
.catalog-description {
  color: var(--muted);
}
.catalog-note,
.catalog-source {
  color: var(--faint);
}
.catalog-shape {
  margin: 0;
  color: var(--text-2);
  font-size: var(--fs-xs);
  line-height: 1.45;
}
.catalog-source a,
.catalog-fill {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.price-label {
  color: var(--muted);
  font-size: var(--fs-xs);
}

@container (min-width: 30rem) {
  .row {
    grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr) 9rem auto;
  }
  .alias {
    grid-column: 3;
  }
  .ctx {
    grid-column: 4;
  }
  .think {
    grid-column: 5;
  }
}
</style>
