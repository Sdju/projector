<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import UiCard from "../../../common/ui/UiCard.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import { watch } from "vue";
import { useProjectWidgetSettings } from "../model/settings.ts";
import type { Project } from "../../project/index.ts";

const props = defineProps<{ project: Project }>();
const { widgets, trusted, file, exists, problem, busy, error, load, trust, commands } =
  useProjectWidgetSettings(() => props.project.id);

watch(
  () => props.project.id,
  () => void load().catch(() => undefined),
  { immediate: true },
);

async function setTrust(value: boolean) {
  await trust(value).catch(() => undefined);
}
</script>

<template>
  <UiStack
    as="section"
    :gap="4"
    class="project-widgets"
    @focusin="commands.scope.activate()"
    @pointerdown="commands.scope.activate()"
  >
    <div class="head">
      <UiInline wrap :gap="2">
        <span class="file">{{ file || ".projector/widgets.json" }}</span>
        <span v-if="trusted" class="trusted">доверено</span>
        <span v-else-if="exists" class="untrusted">не доверено</span>
        <span v-else class="untrusted">файла ещё нет</span>
      </UiInline>
      <UiInline :gap="2">
        <UiButton
          v-if="exists && !trusted"
          appearance="solid"
          size="sm"
          :busy="busy === 'trust'"
          :disabled="!!problem"
          @click="setTrust(true)"
          >Доверять</UiButton
        >
        <UiButton
          v-else-if="trusted"
          appearance="outline"
          size="sm"
          :busy="busy === 'trust'"
          @click="setTrust(false)"
          >Отозвать доверие</UiButton
        >
      </UiInline>
    </div>
    <UiMessage v-if="problem" tone="danger" size="xs" flush role="alert">{{ problem }}</UiMessage>
    <UiMessage v-else-if="exists && !trusted" tone="muted" variant="note" size="xs" flush>
      Виджеты из этого файла не попадают в промпт агента и не рисуются в ответах. Проверьте файл и
      выдайте доверие.
    </UiMessage>
    <p v-if="!widgets.length && !problem" class="empty">
      В файле пока нет виджетов. Опишите их в <code>.projector/widgets.json</code> — после доверия
      они появятся у агента в разделе «Виджеты проекта».
    </p>
    <UiCard v-for="widget in widgets" :key="widget.name" as="article" appearance="frame">
      <div class="title">
        <code>{{ widget.name }}</code>
        <span v-if="widget.special" class="tag">по требованию</span>
        <span v-if="widget.answer" class="tag">форма ответа</span>
        <span v-if="widget.script" class="tag">свой скрипт</span>
      </div>
      <p class="summary">{{ widget.summary }}</p>
      <UiInline wrap :gap="2" class="meta">
        <span v-if="widget.data"> данные: {{ Object.keys(widget.data).join(", ") }} </span>
        <span v-if="widget.refresh">обновление: {{ widget.refresh }} с</span>
        <span v-if="widget.styles">свои стили</span>
        <span v-if="widget.script">скрипт: {{ widget.script.length }} символов</span>
        <span>{{ Object.keys(widget.props ?? {}).length }} свойств</span>
      </UiInline>
    </UiCard>
    <UiHint>
      Файл действует только после доверия. Шаблон собирается из встроенных виджетов и HTML, а
      отдельное поле <code>script</code> выполняется в интерфейсе после загрузки данных. Доверяйте
      только тому коду, который готовы запустить. Данные читаются из JSON-файлов проекта.
    </UiHint>
    <UiMessage v-if="error && error !== problem" tone="danger" size="xs" flush role="alert">{{
      error
    }}</UiMessage>
  </UiStack>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--sp-3);
}
.file {
  min-width: 0;
  color: var(--faint);
  font: var(--fs-2xs) var(--mono);
  overflow-wrap: anywhere;
}
.trusted {
  color: var(--run);
  font-size: var(--fs-2xs);
}
.untrusted {
  color: var(--warn);
  font-size: var(--fs-2xs);
}
.empty {
  margin: 0;
  padding: var(--sp-3);
  border: 1px dashed var(--line);
  border-radius: var(--r-md);
  color: var(--muted);
  font-size: var(--fs-xs);
}
.title {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-wrap: wrap;
}
.title code {
  color: var(--text);
  font-size: var(--fs-xs);
}
.tag {
  padding: 1px 6px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  color: var(--faint);
  font-size: var(--fs-2xs);
}
.summary {
  margin: var(--sp-2) 0;
  color: var(--muted);
  font-size: var(--fs-xs);
  line-height: 1.5;
}
.meta {
  color: var(--faint);
  font-size: var(--fs-2xs);
}
code {
  overflow-wrap: anywhere;
}
</style>
