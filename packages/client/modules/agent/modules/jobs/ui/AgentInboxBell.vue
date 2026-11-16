<script setup lang="ts">
import UiButton from "../../../../../common/ui/UiButton.vue";
import { useCommandScope } from "../../../../../common/utilities/commands.ts";
import { useAgentInbox } from "../model/inbox.ts";
import IconBell from "~icons/lucide/bell";

/**
 * The one counter of work that waits for the user on every project and connected device.
 * The bell always opens the «Работы» tab: panels do not stack over the workspace, and the tab
 * carries its own close action on every screen size.
 */
const props = withDefaults(defineProps<{ scopeId?: string }>(), { scopeId: "inbox" });
const emit = defineEmits<{ open: [] }>();
const { attention, unread, badgeCount, working, noticeUnread } = useAgentInbox();
const commands = useCommandScope(props.scopeId, () => ({
  surface: "inbox",
  attention: attention.value,
  unread: unread.value,
}));
commands.scope.registerCommand({
  id: "ide.inbox.open",
  title: "Открыть работы и уведомления",
  description:
    "Открывает вкладку «Работы»: фоновые задания, живые ходы, завершения и запросы агентов всех проектов и подключённых устройств Hub.",
  run: () => emit("open"),
});
const summary = () => {
  const parts: string[] = [];
  const waiting = Math.max(0, attention.value - noticeUnread.value);
  if (waiting) parts.push(`${waiting} ждут вашего ответа`);
  if (noticeUnread.value) parts.push(`${noticeUnread.value} по доверию`);
  if (unread.value) parts.push(`${unread.value} завершили работу`);
  if (working.value) parts.push(`${working.value} работают`);
  return parts.length
    ? `${parts.join(", ")}; открыть центр работ`
    : "Работы агентов: ничего не ждёт ответа";
};
</script>

<template>
  <UiButton
    class="bell"
    :class="{ alert: attention, fresh: !attention && unread }"
    shape="icon"
    size="sm"
    :title="summary()"
    :aria-label="summary()"
    data-command="ide.inbox.open"
    @click="commands.run('ide.inbox.open')"
  >
    <IconBell aria-hidden="true" />
    <span v-if="badgeCount" class="count" :class="{ info: !attention }" aria-hidden="true">{{
      badgeCount
    }}</span>
    <span v-else-if="working" class="dot" aria-hidden="true" />
  </UiButton>
</template>

<style scoped>
.bell {
  position: relative;
}
.bell.alert {
  color: var(--warn);
}
.bell.fresh {
  color: var(--run);
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
.count.info {
  background: var(--run);
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
