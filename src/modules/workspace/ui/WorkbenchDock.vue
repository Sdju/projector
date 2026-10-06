<script setup lang="ts">
import { computed } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiEmpty from "../../../common/ui/UiEmpty.vue";
import IconFinishFlag from "../../../common/ui/IconFinishFlag.vue";
import { DockView } from "../../dock/index.ts";
import type { ContextMenuItem } from "../../../common/ui/context-menu.ts";
import { TerminalView } from "../../terminal/index.ts";
import type { useOpenFiles } from "../lib/open-files.ts";
import type { useWorkbenchLayout } from "../lib/workbench-layout.ts";
import type { createPanelHosts } from "../panel-hosts.ts";
import type { OpenFile } from "../open-file.ts";
import { useTabHost, useWorkspaceTabs } from "../lib/tab-views.ts";
import FilePanel from "./FilePanel.vue";
import NewSessionMenu from "./NewSessionMenu.vue";
import PanelHost from "./PanelHost.vue";
import IconDiff from "~icons/lucide/file-diff";
import IconRestart from "~icons/lucide/rotate-ccw";
import IconFailed from "~icons/lucide/circle-slash";

const props = defineProps<{
  projectId: string;
  mobile?: boolean;
  mobileSurface?: "editor" | "files" | "terminal";
  workbench: ReturnType<typeof useWorkbenchLayout>;
  files: ReturnType<typeof useOpenFiles>;
  tabActions: (id: string) => ContextMenuItem[];
  panelHosts: ReturnType<typeof createPanelHosts>;
  gutterRevision: number;
  tabs: OpenFile[];
  terminalsBusy: boolean;
  agent?: boolean;
}>();
const emit = defineEmits<{ command: [id: string, args?: unknown] }>();
const { fileOf, terminals, terminalPanels } = props.workbench;
const workspaceTabs = useWorkspaceTabs();
const host = useTabHost();
const viewOf = (tab: OpenFile) => (tab.virtual ? workspaceTabs.views[tab.virtual] : undefined);
/** Вкладки с состоянием: их содержимое живёт вне дока и телепортируется в хост вкладки. */
const kept = computed(() => props.tabs.filter((tab) => viewOf(tab)?.keepAlive));
const isKept = (id: string) => kept.value.some((tab) => tab.key === id);
const hostOf = (key: string) => props.panelHosts.hosts[key] ?? null;
</script>

<template>
  <DockView
    v-model:layout="workbench.layout.value"
    :mobile="mobile"
    :mobile-surface="mobileSurface"
    :terminal-panel="(id) => terminalPanels.has(id) || id.startsWith('terminal:')"
    :describe="workbench.describePanel"
    :project-id="projectId"
    command-namespace="ide.workbench.tabs"
    :tab-actions="tabActions"
    :accepts-drop="files.acceptsFileDrop"
    @select="workbench.selectPanel"
    @close="workbench.closePanel"
    @close-many="workbench.closeManyPanels"
    @rename="workbench.renamePanel"
    @pin="files.pinPreview"
    @drop="files.dropFiles"
  >
    <template #mobileTerminalActions><slot name="mobile-terminal-actions" /></template>
    <template #panel="{ id, focused }">
      <PanelHost v-if="isKept(id)" :id="id" :registry="panelHosts" />
      <FilePanel
        v-else-if="fileOf(id)"
        :file="fileOf(id)!"
        :project-id="projectId"
        :revision="gutterRevision"
        @change="fileOf(id)!.draft = $event"
        @save="files.saveFile(fileOf(id))"
        @mode="fileOf(id)!.markdownMode = $event"
        @open="files.openFile($event)"
      />
      <TerminalView
        v-else-if="terminalPanels.get(id)"
        :project-id="projectId"
        :session="terminalPanels.get(id)!"
        :focused="focused"
        @open="
          (path, line, column, external) =>
            files.openFile(path, line, column, undefined, { external })
        "
        @status="terminals.update"
        @sessions="terminals.replace"
        @ended="terminals.refresh"
      />
    </template>
    <template #leading="{ group }">
      <NewSessionMenu
        v-if="group.role === 'terminal'"
        :busy="terminalsBusy"
        :agent="agent"
        @command="(id, args) => emit('command', id, args)"
      />
    </template>
    <template #icon="{ tab }">
      <IconDiff
        v-if="fileOf(tab.id)?.original !== undefined && fileOf(tab.id)"
        class="diff-tab-icon"
        aria-label="Изменения"
      />
      <template v-else-if="terminalPanels.get(tab.id)">
        <IconFailed
          v-if="terminals.failed(terminalPanels.get(tab.id)!)"
          class="session-state failed"
          aria-hidden="true"
        />
        <IconFinishFlag
          v-else-if="terminalPanels.get(tab.id)!.status === 'exited'"
          class="session-state"
          aria-hidden="true"
        />
      </template>
    </template>
    <template #actions="{ activeId }">
      <template v-if="terminalPanels.get(activeId)">
        <UiButton
          v-if="terminalPanels.get(activeId)!.status === 'running'"
          icon
          size="sm"
          :disabled="terminals.busy.value || terminalPanels.get(activeId)!.stopRequested"
          title="Завершить сессию"
          aria-label="Завершить сессию"
          @click="terminals.stop(terminalPanels.get(activeId)!.id)"
        >
          <IconFinishFlag aria-hidden="true" />
        </UiButton>
        <UiButton
          v-else-if="
            !terminalPanels.get(activeId)!.docker ||
            terminalPanels.get(activeId)!.docker?.kind === 'environment'
          "
          icon
          size="sm"
          :disabled="terminals.busy.value"
          title="Перезапустить сессию"
          aria-label="Перезапустить сессию"
          @click="terminals.restart(terminalPanels.get(activeId)!.id)"
        >
          <IconRestart aria-hidden="true" />
        </UiButton>
      </template>
    </template>
    <template #empty="{ group }">
      <UiEmpty v-if="group.role === 'editor'">
        Откройте файл из дерева или перетащите его сюда
      </UiEmpty>
      <UiEmpty v-else-if="group.role === 'terminal'">
        Нет терминалов. Создайте сессию кнопками на панели выше
      </UiEmpty>
      <UiEmpty v-else>Перетащите сюда вкладку</UiEmpty>
    </template>
  </DockView>
  <div class="keep-alive" hidden>
    <Teleport v-for="tab in kept" :key="tab.key" :to="hostOf(tab.key)" :disabled="!hostOf(tab.key)">
      <div
        :class="viewOf(tab)?.scroll ? 'kept-scroll' : 'kept-panel'"
        :data-own-keys="viewOf(tab)?.ownKeys || undefined"
      >
        <component :is="viewOf(tab)!.component" v-bind="viewOf(tab)!.props?.(tab, host)" />
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.diff-tab-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--run);
}
.session-state {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--muted);
}
.session-state.failed {
  color: var(--err);
}
.kept-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.kept-scroll {
  container-type: inline-size;
  height: 100%;
  overflow: auto;
  padding: var(--sp-4);
}
</style>
