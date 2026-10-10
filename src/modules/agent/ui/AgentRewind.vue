<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import type { RewindSummary } from "../api/client.ts";
import type { RewindScope } from "../model/types.ts";
import IconUndo from "~icons/lucide/undo-2";

const props = defineProps<{
  /** Whether the agent kept backups, so files can be taken back too. */
  canFiles: boolean;
  /** What taking the files back would change; absent while it is being worked out. */
  preview?: RewindSummary;
  previewError: string;
  working: boolean;
  /** What happened to the files, once it has. */
  result?: RewindSummary;
  root: string;
  initial: RewindScope;
}>();
const emit = defineEmits<{
  confirm: [scope: RewindScope];
  cancel: [];
  scope: [scope: RewindScope];
}>();

const scope = ref<RewindScope>(props.initial);
watch(scope, (value) => emit("scope", value), { immediate: true });
const withFiles = computed(() => scope.value !== "conversation");
const relative = (path: string) =>
  props.root && path.startsWith(`${props.root}/`) ? path.slice(props.root.length + 1) : path;
const options = computed(
  (): { value: RewindScope; name: string; note: string; files: boolean }[] => [
    {
      value: "conversation",
      name: "Только разговор",
      note: "Сообщение вернётся в поле ввода; файлы останутся как есть",
      files: false,
    },
    {
      value: "both",
      name: "Разговор и файлы",
      note: "И сообщения, и изменения в проекте возвращаются на этот шаг",
      files: true,
    },
    {
      value: "files",
      name: "Только файлы",
      note: "Разговор остаётся, файлы возвращаются на этот шаг",
      files: true,
    },
  ],
);
</script>

<template>
  <section class="rewind" role="dialog" aria-label="Откат к сообщению">
    <header>
      <IconUndo aria-hidden="true" />
      <span>Откатить к этому сообщению</span>
    </header>
    <template v-if="!result">
      <label
        v-for="option in options"
        :key="option.value"
        :class="{ off: option.files && !canFiles }"
      >
        <input
          v-model="scope"
          type="radio"
          name="rewind-scope"
          :value="option.value"
          :disabled="option.files && !canFiles"
        />
        <span>
          <b>{{ option.name }}</b>
          <small>{{
            option.files && !canFiles ? "Этот агент не хранит резервные копии файлов" : option.note
          }}</small>
        </span>
      </label>
      <div v-if="withFiles" class="preview" aria-live="polite">
        <template v-if="previewError">{{ previewError }}</template>
        <template v-else-if="!preview">Считаю, что изменится…</template>
        <template v-else-if="!preview.ok">{{ preview.error || "Вернуть файлы нельзя" }}</template>
        <template v-else-if="!preview.files.length">Файлы уже такие, как на этом шаге.</template>
        <template v-else>
          Изменится файлов: {{ preview.files.length }}
          <span class="added">+{{ preview.insertions ?? 0 }}</span>
          <span class="removed">−{{ preview.deletions ?? 0 }}</span>
          <ul>
            <li v-for="file in preview.files.slice(0, 12)" :key="file">{{ relative(file) }}</li>
            <li v-if="preview.files.length > 12">и ещё {{ preview.files.length - 12 }}</li>
          </ul>
        </template>
      </div>
      <div class="actions">
        <UiButton
          variant="solid"
          size="sm"
          :disabled="working || (withFiles && (!preview || !preview.ok))"
          @click="emit('confirm', scope)"
        >
          Откатить
        </UiButton>
        <UiButton variant="ghost" size="sm" @click="emit('cancel')">Отмена</UiButton>
      </div>
    </template>
    <template v-else>
      <p class="preview" role="status">
        <template v-if="result.ok"> Файлов возвращено: {{ result.files.length }}. </template>
        <template v-else>{{ result.error || "Не удалось вернуть файлы" }}</template>
      </p>
      <div class="actions">
        <UiButton variant="ghost" size="sm" @click="emit('cancel')">Закрыть</UiButton>
      </div>
    </template>
  </section>
</template>

<style scoped>
.rewind {
  display: grid;
  gap: var(--sp-2);
  margin: 0 0 var(--sp-2);
  padding: var(--sp-3);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-lg);
  background: var(--bg-2);
  font-size: var(--fs-2xs);
  color: var(--muted);
}
header {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--text);
}
svg {
  width: 14px;
  height: 14px;
}
label {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  cursor: pointer;
}
label.off {
  opacity: 0.5;
  cursor: default;
}
label span {
  display: grid;
  gap: 1px;
}
b {
  font-weight: 500;
  color: var(--text-2);
}
small {
  font-size: var(--fs-2xs);
  color: var(--faint);
}
.preview {
  margin: 0;
  padding: var(--sp-2);
  border-radius: var(--r-md);
  background: var(--bg-3);
  line-height: 1.5;
}
ul {
  margin: var(--sp-1) 0 0;
  padding: 0;
  list-style: none;
  font-family: var(--mono);
  overflow-wrap: anywhere;
}
.added {
  color: var(--run);
  font-family: var(--mono);
}
.removed {
  color: var(--err);
  font-family: var(--mono);
}
.actions {
  display: flex;
  gap: var(--sp-2);
}
</style>
