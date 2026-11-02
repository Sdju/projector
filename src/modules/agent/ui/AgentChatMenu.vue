<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import UiIsland from "../../../common/ui/UiIsland.vue";
import UiIslandLabel from "../../../common/ui/UiIslandLabel.vue";
import { useIslandMenu } from "../../../common/utilities/island-menu.ts";
import IconBranch from "~icons/lucide/git-branch";
import IconCheck from "~icons/lucide/check";
import IconDownload from "~icons/lucide/download";
import IconEllipsis from "~icons/lucide/ellipsis";
import IconMessageCircleQuestion from "~icons/lucide/message-circle-question";
import IconScanEye from "~icons/lucide/scan-eye";
import IconScale from "~icons/lucide/scale";
import IconSparkles from "~icons/lucide/sparkles";

/** Secondary chat actions, kept out of the header so it stays a short row of durable controls. */
const props = defineProps<{
  lens: boolean;
  side: boolean;
  /** The chat has messages, so it can be saved. */
  canDownload: boolean;
  /** An external agent's conversation can be isolated before its first message. */
  canIsolate: boolean;
  isolate: boolean;
  /** The chat overrides the agent's feature defaults, so the menu marks it. */
  featuresChanged: boolean;
  /** The chat overrides the global Judge settings. */
  judgeChanged: boolean;
}>();
const emit = defineEmits<{
  lens: [];
  side: [];
  features: [];
  judge: [];
  download: [];
  isolate: [];
}>();
const menu = useIslandMenu({
  anchor: "right",
  initialFocus: "button.item",
  items: "button.item",
  returnFocus: "button",
});
defineExpose({ anchor: () => menu.trigger.value });
function run(action: "lens" | "side" | "features" | "judge" | "download" | "isolate") {
  menu.close();
  switch (action) {
    case "lens":
      emit("lens");
      break;
    case "side":
      emit("side");
      break;
    case "features":
      emit("features");
      break;
    case "judge":
      emit("judge");
      break;
    case "download":
      emit("download");
      break;
    case "isolate":
      emit("isolate");
      break;
  }
}
</script>

<template>
  <div :ref="menu.trigger" class="chat-menu">
    <UiButton
      shape="icon"
      size="sm"
      title="Ещё"
      aria-label="Ещё"
      :active="lens || side || isolate || featuresChanged || judgeChanged"
      :aria-expanded="menu.open.value"
      @click="menu.toggle()"
    >
      <IconEllipsis aria-hidden="true" />
    </UiButton>
    <UiIsland :menu="menu" label="Действия чата" :width="300">
      <UiIslandLabel>Чат</UiIslandLabel>
      <button type="button" class="item" @click="run('features')">
        <IconSparkles aria-hidden="true" />
        <span class="text">
          <span class="title">Возможности агента</span>
          <span class="hint">Виджеты и команды IDE в этом чате</span>
        </span>
        <span v-if="featuresChanged" class="dot" aria-hidden="true" />
      </button>
      <button type="button" class="item" @click="run('judge')">
        <IconScale aria-hidden="true" />
        <span class="text">
          <span class="title">Судья</span>
          <span class="hint">Риск действия и автоматическое разрешение</span>
        </span>
        <span v-if="judgeChanged" class="dot" aria-hidden="true" />
      </button>
      <button type="button" class="item" :aria-pressed="lens" @click="run('lens')">
        <IconScanEye aria-hidden="true" />
        <span class="text">
          <span class="title">Lens</span>
          <span class="hint">Чем агент занят сейчас</span>
        </span>
        <IconCheck v-if="lens" class="state" aria-hidden="true" />
      </button>
      <button type="button" class="item" :aria-pressed="side" @click="run('side')">
        <IconMessageCircleQuestion aria-hidden="true" />
        <span class="text">
          <span class="title">Вопрос в сторону</span>
          <span class="hint">Не прерывает агента и не попадает в чат</span>
        </span>
        <IconCheck v-if="side" class="state" aria-hidden="true" />
      </button>
      <button v-if="canDownload" type="button" class="item" @click="run('download')">
        <IconDownload aria-hidden="true" />
        <span class="text">
          <span class="title">Скачать в Markdown</span>
          <span class="hint">Вся переписка одним файлом</span>
        </span>
      </button>
      <button
        v-if="canIsolate"
        type="button"
        class="item"
        :aria-pressed="isolate"
        @click="run('isolate')"
      >
        <IconBranch aria-hidden="true" />
        <span class="text">
          <span class="title">Изолированная копия</span>
          <span class="hint">git worktree: файлы не меняются до слияния</span>
        </span>
        <IconCheck v-if="isolate" class="state" aria-hidden="true" />
      </button>
    </UiIsland>
  </div>
</template>

<style scoped>
.chat-menu {
  display: inline-flex;
}
.item {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--r-md, 6px);
  background: none;
  color: var(--text);
  text-align: start;
}
.item:hover,
.item:focus-visible {
  background: var(--hover);
}
.item > svg:first-child {
  width: 16px;
  height: 16px;
  flex: none;
  margin-top: 1px;
  color: var(--muted);
}
.item[aria-pressed="true"] > svg:first-child {
  color: var(--text);
}
.text {
  display: grid;
  flex: 1;
  gap: 1px;
  min-width: 0;
}
.title {
  font-size: var(--fs-xs);
}
.hint {
  color: var(--faint);
  font-size: var(--fs-2xs);
  line-height: 1.3;
}
.dot {
  width: 5px;
  height: 5px;
  flex: none;
  margin-top: 6px;
  border-radius: var(--r-full);
  background: var(--accent);
}
.state {
  width: 14px;
  height: 14px;
  flex: none;
  margin-top: 2px;
  color: var(--accent);
}
</style>
