<script setup lang="ts">
import { useRouter } from "vue-router";
import UiButton from "../../common/ui/UiButton.vue";
import { deviceBase, deviceRoute } from "../../common/utilities/device-url.ts";
import { useCommandScope } from "../../common/utilities/commands.ts";
import { registerAppUpdateCommands } from "./commands.ts";
import { useAppUpdate } from "./model.ts";

const href = `${deviceBase()}/settings?section=about`;
const { snapshot, inbox } = useAppUpdate();
const router = useRouter();
const commands = useCommandScope("app-update-inbox", () => ({
  surface: "inbox",
  offer: inbox.value,
}));
registerAppUpdateCommands(commands.scope);

function open(event: MouseEvent) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button === 1)
    return;
  event.preventDefault();
  const route = deviceRoute(href);
  if (route) void router.push(route);
  else location.assign(href);
}
</script>

<template>
  <article v-if="inbox && snapshot?.latest" class="item">
    <a class="main" :href="href" @click="open">
      <span class="topic">Доступен Projector {{ snapshot.latest }}</span>
      <span class="preview"
        >Ставится командой npm с точной версией. Restart завершит терминалы и ходы агентов.</span
      >
    </a>
    <UiButton
      size="sm"
      data-command="ide.app.update.dismiss"
      @click="commands.run('ide.app.update.dismiss')"
      >Не напоминать</UiButton
    >
  </article>
</template>

<style scoped>
.item {
  display: flex;
  gap: var(--sp-3);
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-3);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
}
.main {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--sp-1);
  color: inherit;
  text-decoration: none;
}
.topic {
  font-weight: 600;
}
.preview {
  color: var(--muted);
  font-size: var(--fs-xs);
}
</style>
