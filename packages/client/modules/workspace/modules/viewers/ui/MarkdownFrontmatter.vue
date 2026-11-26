<script setup lang="ts">
import { nextTick, ref } from "vue";
import {
  addFrontmatterEntry,
  parseFrontmatter,
  removeFrontmatterEntry,
  setFrontmatterValue,
  type Frontmatter,
} from "../lib/frontmatter.ts";

const props = defineProps<{
  frontmatter: Frontmatter;
  editable: boolean;
}>();
const emit = defineEmits<{ change: [raw: string]; source: [] }>();
const panel = ref<HTMLDetailsElement>();
const newKey = ref<string>();
const vFocus = { mounted: (element: HTMLElement) => element.focus() };
function editValue(index: number, event: Event) {
  const field = event.target as HTMLTextAreaElement;
  const current = props.frontmatter.entries[index]!.value;
  const raw = setFrontmatterValue(props.frontmatter, index, field.value);
  if (raw === undefined || raw === props.frontmatter.raw) {
    field.value = current;
    return;
  }
  const updated = parseFrontmatter(raw);
  emit("change", raw);
  // Значение, которое YAML-слой не принял, возвращаем к тому, что в файле.
  field.value = updated.entries[index]?.value ?? current;
}
function removeEntry(index: number) {
  const raw = removeFrontmatterEntry(props.frontmatter, index);
  if (raw !== undefined && raw !== props.frontmatter.raw) emit("change", raw);
}
async function commitKey() {
  const key = newKey.value?.trim();
  newKey.value = undefined;
  if (!key) return;
  const raw = addFrontmatterEntry(props.frontmatter, key);
  if (raw === undefined || raw === props.frontmatter.raw) return;
  emit("change", raw);
  await nextTick();
  panel.value?.querySelector<HTMLTextAreaElement>("dd:last-of-type textarea")?.focus();
}
</script>

<template>
  <details ref="panel" class="frontmatter" open>
    <summary>
      <span>Свойства</span>
      <button
        v-if="editable"
        type="button"
        class="frontmatter-edit"
        @click.prevent="emit('source')"
      >
        Изменить в исходнике
      </button>
    </summary>
    <dl v-if="frontmatter.entries.length">
      <template v-for="(entry, index) in frontmatter.entries" :key="`${index}:${entry.key}`">
        <dt>
          <span>{{ entry.key }}</span>
          <button
            v-if="editable"
            type="button"
            class="frontmatter-remove"
            :aria-label="`Удалить свойство ${entry.key}`"
            @click="removeEntry(index)"
          >
            ×
          </button>
        </dt>
        <dd>
          <textarea
            v-if="editable"
            :value="entry.value"
            rows="1"
            spellcheck="false"
            :aria-label="entry.key"
            @change="editValue(index, $event)"
          />
          <template v-else>{{ entry.value }}</template>
        </dd>
      </template>
    </dl>
    <p v-else class="frontmatter-empty">Пустой блок</p>
    <div v-if="editable" class="frontmatter-add">
      <input
        v-if="newKey !== undefined"
        v-model="newKey"
        v-focus
        placeholder="Имя свойства"
        aria-label="Имя нового свойства"
        @keydown.enter.prevent="commitKey"
        @keydown.esc.prevent="newKey = undefined"
        @blur="commitKey"
      />
      <button v-else type="button" @click="newKey = ''">+ Свойство</button>
    </div>
  </details>
</template>

<style scoped>
.frontmatter {
  max-width: calc(820px - 2 * clamp(32px, 4vw, 56px));
  margin: 28px auto -12px;
  width: calc(100% - 2 * clamp(32px, 4vw, 56px));
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg-2);
  font-size: var(--fs-sm);
}
.frontmatter summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-2) var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-xs);
  cursor: pointer;
  user-select: none;
}
.frontmatter-edit {
  color: var(--muted);
  text-decoration: underline;
}
.frontmatter-edit:hover {
  color: var(--text);
}
.frontmatter dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sp-1) var(--sp-4);
  margin: 0;
  padding: var(--sp-1) var(--sp-3) var(--sp-3);
  border-top: 1px solid var(--line);
  padding-top: var(--sp-3);
}
.frontmatter dt {
  color: var(--muted);
  font-family: var(--mono);
  font-size: var(--fs-xs);
  line-height: 1.6;
}
.frontmatter dd {
  margin: 0;
  min-width: 0;
  white-space: pre-line;
  overflow-wrap: anywhere;
  line-height: 1.6;
}
.frontmatter dt {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-1);
}
.frontmatter-remove {
  color: var(--faint);
  line-height: 1.6;
  opacity: 0;
}
.frontmatter dt:hover .frontmatter-remove,
.frontmatter-remove:focus-visible {
  opacity: 1;
}
.frontmatter-remove:hover {
  color: var(--err);
}
.frontmatter textarea {
  display: block;
  width: 100%;
  min-height: 0;
  padding: 0 var(--sp-1);
  margin: 0 calc(-1 * var(--sp-1));
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: 1.6;
  resize: none;
  field-sizing: content;
}
.frontmatter textarea:hover {
  border-color: var(--line);
}
.frontmatter textarea:focus {
  border-color: var(--info);
  outline: none;
  background: var(--bg-sunken);
}
.frontmatter-add {
  padding: 0 var(--sp-3) var(--sp-2);
  font-size: var(--fs-xs);
}
.frontmatter-add button {
  color: var(--muted);
}
.frontmatter-add button:hover {
  color: var(--text);
}
.frontmatter-add input {
  width: 200px;
  font-family: var(--mono);
  font-size: var(--fs-xs);
}
.frontmatter-empty {
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
  color: var(--muted);
}
@media (max-width: 700px) {
  .frontmatter {
    margin: var(--sp-4) var(--sp-4) 0;
    width: auto;
  }
  .frontmatter dl {
    grid-template-columns: 1fr;
  }
}
</style>
