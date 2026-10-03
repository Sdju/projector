<script setup lang="ts">
import { nextTick, useId, ref, watch } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiDialog from "../../../common/ui/UiDialog.vue";
import UiDialogActions from "../../../common/ui/UiDialogActions.vue";
import type { TerminalSession } from "../../../../core/modules/terminal/index.ts";

const props = defineProps<{ session: TerminalSession | null; busy: boolean }>();
defineEmits<{ cancel: []; confirm: [] }>();
const dialog = ref<InstanceType<typeof UiDialog>>();
const titleId = useId();
watch(
  () => props.session,
  async (session) => {
    await nextTick();
    if (session && dialog.value && !dialog.value.element?.open) dialog.value.open();
  },
);
</script>

<template>
  <UiDialog
    v-if="session"
    ref="dialog"
    class="close-dialog"
    width="440px"
    :labelledby="titleId"
    @cancel.prevent="$emit('cancel')"
  >
    <h2 :id="titleId">Прервать процессы и закрыть вкладку?</h2>
    <p>
      {{ session.title }} ·
      {{
        session.activity?.state === "unknown"
          ? "Не удалось определить, простаивает ли терминал."
          : "В терминале работают процессы:"
      }}
    </p>
    <ul v-if="session.activity?.processes.length">
      <li v-for="process in session.activity.processes" :key="process.pid">
        <span>{{ process.name }}</span
        ><span class="process-pid">PID {{ process.pid }}</span>
      </li>
    </ul>
    <UiDialogActions>
      <UiButton autofocus :disabled="busy" @click="$emit('cancel')">Отмена</UiButton>
      <UiButton variant="danger" :disabled="busy" @click="$emit('confirm')"
        >Прервать и закрыть</UiButton
      >
    </UiDialogActions>
  </UiDialog>
</template>

<style scoped>
.close-dialog h2 {
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-md);
  font-weight: 500;
}
.close-dialog p {
  color: var(--muted);
  font-size: var(--fs-xs);
  line-height: 1.6;
}
.close-dialog ul {
  list-style: none;
  padding: 0;
  max-height: 180px;
  overflow: auto;
}
.close-dialog li {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  padding: 7px 0;
  font: var(--fs-xs) var(--mono);
}
.process-pid {
  color: var(--faint);
}
</style>
