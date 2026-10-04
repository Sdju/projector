<script setup lang="ts">
import { nextTick, useId, ref, watch } from "vue";
import UiButton from "../../common/ui/UiButton.vue";
import UiDialog from "../../common/ui/UiDialog.vue";
import UiDialogActions from "../../common/ui/UiDialogActions.vue";
import type { DevcontainerRisk } from "../../../core/modules/devcontainer/index.ts";
import { useDevcontainer } from "./model.ts";

const props = defineProps<{ projectId: string }>();
const model = useDevcontainer(props.projectId);
const dialog = ref<InstanceType<typeof UiDialog>>();
const titleId = useId();
const RISK: Record<DevcontainerRisk, string> = {
  host: "на вашем компьютере",
  root: "от root при сборке",
  container: "в контейнере",
};
watch(
  () => model.visible.value,
  async (visible) => {
    await nextTick();
    if (visible && dialog.value && !dialog.value.element?.open) dialog.value.open();
    if (!visible) dialog.value?.close();
  },
  { immediate: true },
);
</script>

<template>
  <UiDialog
    v-if="model.visible.value && model.state.value"
    ref="dialog"
    class="trust"
    width="560px"
    :labelledby="titleId"
    @cancel.prevent="model.open.value = false"
    @close="model.open.value = false"
  >
    <h2 :id="titleId">Доверять этому репозиторию?</h2>
    <p>
      Проект содержит <code>{{ model.state.value.configPath }}</code
      ><template v-if="model.state.value.name"> ({{ model.state.value.name }})</template>. Он просит
      возможности, которых нет в изолированном режиме Projector.
      <strong v-if="model.state.value.stale"
        >Конфигурация изменилась после вашего прошлого решения.</strong
      >
    </p>
    <ul class="findings">
      <li v-for="finding in model.state.value.findings" :key="finding.id" :class="finding.risk">
        <div class="head">
          <strong>{{ finding.title }}</strong>
          <span class="risk">{{ RISK[finding.risk] }}</span>
        </div>
        <p>{{ finding.detail }}</p>
        <code>{{ finding.keys.join(", ") }}</code>
      </li>
    </ul>
    <p class="muted">
      <strong>Не доверять</strong> — проект продолжит работать в нашей модели (ограниченный Docker
      или хост). <strong>Доверять</strong> — терминалы откроются в Dev Container по этому конфигу,
      со всеми перечисленными правами. Если файлы конфигурации изменятся, решение сбросится. Уже
      открытые терминалы не переключаются.
    </p>
    <p v-if="model.error.value" class="error" role="alert">{{ model.error.value }}</p>
    <UiDialogActions>
      <UiButton autofocus :disabled="model.busy.value" @click="model.decide('declined')"
        >Не доверять</UiButton
      >
      <UiButton variant="danger" :disabled="model.busy.value" @click="model.decide('trusted')"
        >Доверять и использовать Dev Container</UiButton
      >
    </UiDialogActions>
  </UiDialog>
</template>

<style scoped>
.trust h2 {
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-md);
  font-weight: 500;
}
.trust p {
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-sm);
  line-height: 1.5;
}
.muted {
  color: var(--muted);
}
.findings {
  display: grid;
  gap: var(--sp-2);
  margin: 0 0 var(--sp-3);
  padding: 0;
  list-style: none;
  max-height: 40vh;
  overflow: auto;
}
.findings li {
  border: 1px solid var(--line);
  border-left-width: 3px;
  border-radius: var(--r-sm);
  padding: var(--sp-2) var(--sp-3);
}
.findings li.host {
  border-left-color: var(--err);
}
.findings li.root {
  border-left-color: var(--warn, var(--err));
}
.findings p {
  margin: var(--sp-1) 0;
  color: var(--muted);
  font-size: var(--fs-xs);
}
.head {
  display: flex;
  justify-content: space-between;
  gap: var(--sp-3);
  font-size: var(--fs-sm);
}
.risk {
  color: var(--muted);
  font-size: var(--fs-xs);
  white-space: nowrap;
}
code {
  overflow-wrap: anywhere;
  font-size: var(--fs-xs);
}
.error {
  color: var(--err);
}
</style>
