<script setup lang="ts">
import { ref } from "vue";
import UiButton from "../../../../../common/ui/UiButton.vue";
import UiDialog from "../../../../../common/ui/UiDialog.vue";
import { useCommandScope } from "../../../../../common/utilities/commands.ts";
import { useCompactViewport } from "../../../../../common/utilities/compact-viewport.ts";
import { useAgentInbox } from "../model/inbox.ts";
import AgentInbox from "./AgentInbox.vue";
import IconBell from "~icons/lucide/bell";

/** The one counter of work that waits for the user on every project and connected device. */
const props = withDefaults(defineProps<{ scopeId?: string }>(), { scopeId: "inbox" });
const emit = defineEmits<{ open: [] }>();
const { attention, working } = useAgentInbox();
const compact = useCompactViewport();
const dialog = ref<InstanceType<typeof UiDialog>>();
const open = ref(false);
const commands = useCommandScope(props.scopeId, () => ({
  surface: "inbox",
  attention: attention.value,
}));
commands.scope.registerCommand({
  id: "ide.inbox.open",
  title: "Открыть работы и уведомления",
  description:
    "Открывает панель с фоновыми заданиями, живыми ходами и запросами агентов всех проектов и подключённых устройств Hub.",
  run: () => {
    if (compact.value) {
      open.value = true;
      dialog.value?.open();
    } else emit("open");
  },
});
function closed() {
  open.value = false;
}
function close() {
  open.value = false;
  dialog.value?.close();
}
const summary = () => {
  if (attention.value) return `${attention.value} работ ждут вашего ответа; открыть центр работ`;
  if (working.value) return `${working.value} работ идут; открыть центр работ`;
  return "Работы агентов: ничего не ждёт ответа";
};
</script>

<template>
  <UiButton
    class="bell"
    :class="{ alert: attention }"
    shape="icon"
    size="sm"
    :title="summary()"
    :aria-label="summary()"
    data-command="ide.inbox.open"
    @click="commands.run('ide.inbox.open')"
  >
    <IconBell aria-hidden="true" />
    <span v-if="attention" class="count" aria-hidden="true">{{ attention }}</span>
    <span v-else-if="working" class="dot" aria-hidden="true" />
  </UiButton>
  <UiDialog
    v-if="compact"
    ref="dialog"
    label="Работы агентов"
    align="top"
    width="440px"
    fullscreen
    flush
    @close="closed"
  >
    <AgentInbox v-if="open" :scope-id="`agent-inbox:${scopeId}`" @navigate="close" />
  </UiDialog>
</template>

<style scoped>
.bell {
  position: relative;
}
.bell.alert {
  color: var(--warn);
}
.count {
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: var(--r-full);
  background: var(--warn);
  color: var(--bg);
  font-family: var(--mono);
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  line-height: 14px;
  text-align: center;
}
.dot {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 5px;
  height: 5px;
  border-radius: var(--r-full);
  background: var(--run);
}
</style>
