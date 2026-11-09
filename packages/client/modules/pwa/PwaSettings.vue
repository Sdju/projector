<script setup lang="ts">
import UiBadge from "../../common/ui/UiBadge.vue";
import UiButton from "../../common/ui/UiButton.vue";
import UiHeading from "../../common/ui/UiHeading.vue";
import UiHint from "../../common/ui/UiHint.vue";
import UiInline from "../../common/ui/UiInline.vue";
import UiMessage from "../../common/ui/UiMessage.vue";
import {
  fullscreenAvailable,
  installApp,
  isSecurePwaOrigin,
  toggleFullscreen,
  usePwa,
} from "./model.ts";
import { useSectionAction } from "../../common/utilities/use-section-action.ts";

const { canInstall, installed, standalone, fullscreen, worker, mode, error } = usePwa();
const { busy, status, perform } = useSectionAction({ error });
const fullscreenSupported = fullscreenAvailable();
const secure = isSecurePwaOrigin();
const iphone = /iPhone|iPad|iPod/i.test(navigator.userAgent);

async function install() {
  await perform(
    async () => {
      const outcome = await installApp();
      return outcome === "accepted"
        ? "Установка принята: Projector появится среди приложений."
        : outcome === "installed"
          ? "Projector уже открыт как приложение."
          : "Установка отменена.";
    },
    { errorFallback: "Не удалось установить приложение" },
  );
}

async function toggle() {
  await perform(
    async () => {
      const active = await toggleFullscreen();
      return active ? "Полноэкранный режим включён." : "Полноэкранный режим выключен.";
    },
    { errorFallback: "Не удалось переключить режим" },
  );
}
</script>

<template>
  <section class="pwa-settings">
    <UiHeading as="h2" size="sm">Установка приложения</UiHeading>
    <UiHint class="hint">
      Projector — локальный сервер: установка добавляет иконку и отдельное окно без адресной строки.
      Офлайн-режима нет — файлы, Git и терминалы работают только с запущенным сервером.
    </UiHint>
    <UiInline class="badges" align="center" wrap>
      <UiBadge :tone="standalone ? 'info' : 'neutral'">{{
        standalone ? "открыто как приложение" : "вкладка браузера"
      }}</UiBadge>
      <UiBadge v-if="installed" tone="info">установлено</UiBadge>
      <UiBadge v-if="worker === 'active'" tone="info">service worker</UiBadge>
      <UiBadge v-else-if="worker === 'none'">без service worker</UiBadge>
      <UiBadge v-if="mode !== 'unknown'">{{ mode }}</UiBadge>
      <UiBadge :tone="secure ? 'neutral' : 'warning'">{{
        secure ? "localhost или HTTPS" : "HTTP в сети"
      }}</UiBadge>
    </UiInline>

    <UiHint v-if="standalone" class="hint">
      Окно уже работает без браузерной обвязки. Полноэкранный режим скрывает и системные панели.
    </UiHint>
    <UiHint v-else-if="mode === 'dev'" class="hint">
      Сервер работает в dev: service worker отключён, поэтому при выключенном сервере нет даже
      страницы «Projector не отвечает». Установка доступна, если браузер её предлагает; в Chrome и
      Edge — меню → «Установить приложение».
    </UiHint>
    <UiHint v-else-if="!canInstall && !iphone" class="hint">
      Браузер предложит установку, когда сочтёт страницу готовой. Если предложения нет, используйте
      меню браузера → «Установить приложение» (Chrome/Edge).
    </UiHint>
    <UiHint v-if="iphone" class="hint">
      Safari на iPhone не показывает системное предложение: откройте «Поделиться» → «На экран
      Домой». Полноэкранный режим там даёт только установленное приложение.
    </UiHint>
    <UiHint v-if="!secure" class="hint">
      Адрес в локальной сети открыт по HTTP. Установка и service worker требуют HTTPS или localhost;
      для телефона нужен сертификат либо туннель с HTTPS.
    </UiHint>

    <UiInline class="actions" align="stretch" wrap>
      <UiButton
        appearance="solid"
        :disabled="busy || !canInstall || standalone"
        :busy="busy"
        @click="install"
        >Установить приложение</UiButton
      >
      <UiButton v-if="fullscreenSupported" :disabled="busy" @click="toggle">{{
        fullscreen ? "Выйти из полного экрана" : "На весь экран"
      }}</UiButton>
    </UiInline>
    <UiMessage v-if="error" role="alert" tone="danger" size="xs" class="message">{{
      error
    }}</UiMessage>
    <UiMessage v-else-if="status" role="status" size="xs" class="message">{{ status }}</UiMessage>
  </section>
</template>

<style scoped>
.pwa-settings {
  margin-bottom: var(--ui-section-margin, var(--sp-6));
}
.badges {
  margin-top: var(--sp-3);
}
.hint {
  margin-top: var(--sp-3);
  font-size: var(--fs-xs);
}
.actions {
  margin-top: var(--sp-4);
}
.message {
  margin-top: var(--sp-3);
}
</style>
