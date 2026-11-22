<script setup lang="ts">
import { computed, onMounted } from "vue";
import UiBadge from "../../common/ui/UiBadge.vue";
import UiButton from "../../common/ui/UiButton.vue";
import UiHeading from "../../common/ui/UiHeading.vue";
import UiHint from "../../common/ui/UiHint.vue";
import UiInline from "../../common/ui/UiInline.vue";
import UiMessage from "../../common/ui/UiMessage.vue";
import { copyWithNotice } from "../../common/utilities/notice.ts";
import { useCommandScope } from "../../common/utilities/commands.ts";
import { readoutLines, useTabReadout } from "../../common/utilities/tab-readout.ts";
import { registerAppUpdateCommands } from "./commands.ts";
import { checkAppUpdateNow, copyUpdateCommand, useAppUpdate } from "./model.ts";

const { snapshot, busy, error, offer, inbox, command } = useAppUpdate();
const sourceLabel = computed(() => {
  const source = snapshot.value?.source;
  if (source === "npm") return "npm";
  if (source === "checkout") return "исходники";
  return "не npm";
});
const commands = useCommandScope("app-update-settings", () => ({
  surface: "settings",
  section: "about",
  source: snapshot.value?.source ?? "",
  offer: offer.value,
  busy: busy.value,
}));

registerAppUpdateCommands(commands.scope);

useTabReadout(() => ({
  note: "О приложении",
  text: readoutLines(
    snapshot.value?.version ? `Версия: ${snapshot.value.version}` : "Версия неизвестна",
    `Источник: ${sourceLabel.value}`,
    snapshot.value?.latest ? `npm latest: ${snapshot.value.latest}` : "",
    snapshot.value?.native?.lockstep && "native другой версии",
    offer.value && "доступно обновление",
    error.value && `Ошибка: ${error.value}`,
  ),
}));

onMounted(() => {
  if (!snapshot.value) void checkAppUpdateNow().catch(() => {});
});

async function copy(event: Event) {
  await copyWithNotice(
    event.currentTarget as Element,
    await copyUpdateCommand(),
    "Команда скопирована",
    "Не удалось скопировать команду",
  );
}
</script>

<template>
  <section
    class="about"
    @focusin="commands.scope.activate()"
    @pointerdown="commands.scope.activate()"
    @keydown="commands.keydown"
  >
    <UiHeading as="h2" size="sm">О приложении</UiHeading>
    <UiHint>
      Projector ставится из npm. Обновление не подменяет работающий процесс: скопируйте команду,
      выполните её в терминале и сделайте <code>projector restart</code>. Restart завершает
      терминалы и ходы агентов.
    </UiHint>
    <UiInline class="badges" align="center" wrap>
      <UiBadge mono>{{ snapshot?.version || "без версии" }}</UiBadge>
      <UiBadge>{{ sourceLabel }}</UiBadge>
      <UiBadge v-if="snapshot?.latest" :tone="offer ? 'info' : 'neutral'" mono
        >latest {{ snapshot.latest }}</UiBadge
      >
      <UiBadge v-if="snapshot?.native" :tone="snapshot.native.lockstep ? 'warning' : 'neutral'"
        >native {{ snapshot.native.version || "?" }}</UiBadge
      >
      <UiBadge v-if="snapshot?.hub" :tone="snapshot.hub.lockstep ? 'warning' : 'neutral'"
        >hub {{ snapshot.hub.version || "?" }}</UiBadge
      >
    </UiInline>
    <UiHint v-if="snapshot?.source === 'checkout'" class="hint">
      Это checkout исходников. Обновляйте через git, а не <code>npm install -g</code>.
    </UiHint>
    <UiHint v-else-if="snapshot?.source === 'other'" class="hint">
      Канал установки не похож на глобальный npm. Команда ниже сработает, только если пакет ставили
      через npm.
    </UiHint>
    <UiHint v-else-if="offer" class="hint">
      Доступна {{ snapshot?.latest }}. Команда пинит эту версию, а не плавающий
      <code>@latest</code>.
      <a v-if="snapshot?.notesUrl" :href="snapshot.notesUrl" target="_blank" rel="noreferrer"
        >Заметки выпуска</a
      >.
    </UiHint>
    <UiHint v-else-if="snapshot?.latest" class="hint"
      >Установленная версия совпадает с npm latest.</UiHint
    >
    <UiMessage v-if="snapshot?.native?.lockstep || snapshot?.hub?.lockstep" tone="danger" size="xs">
      Версии ide и дополнения разошлись. Ставьте пакеты одной версии.
    </UiMessage>
    <pre v-if="command" class="command">{{ command }}</pre>
    <UiInline class="actions" align="stretch" wrap>
      <UiButton
        appearance="solid"
        :busy="busy"
        :disabled="busy"
        data-command="ide.app.update.check"
        @click="commands.run('ide.app.update.check')"
        >Проверить</UiButton
      >
      <UiButton :disabled="busy || !command" data-command="ide.app.update.copyCommand" @click="copy"
        >Скопировать команду</UiButton
      >
      <UiButton
        v-if="inbox"
        :disabled="busy"
        data-command="ide.app.update.dismiss"
        @click="commands.run('ide.app.update.dismiss')"
        >Не напоминать</UiButton
      >
    </UiInline>
    <UiMessage v-if="error" role="alert" tone="danger" size="xs">{{ error }}</UiMessage>
  </section>
</template>

<style scoped>
.about {
  margin-bottom: var(--ui-section-margin, var(--sp-6));
}
.badges,
.hint,
.actions,
.message,
.command {
  margin-top: var(--sp-3);
}
.command {
  margin-bottom: 0;
  padding: var(--sp-3);
  overflow-x: auto;
  font: var(--fs-xs) / 1.45 var(--font-mono);
  white-space: pre-wrap;
  background: var(--bg-2);
  border-radius: var(--r-sm);
}
.actions {
  margin-top: var(--sp-4);
}
</style>
