<script setup lang="ts">
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
import { AgentChat } from "../../agent/index.ts";
import FilePanel from "./FilePanel.vue";
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
  /** Панели с состоянием, которые живут вне дока и телепортируются в хост вкладки. */
  keepAlive: Set<string>;
  gutterRevision: number;
  tabs: OpenFile[];
  /** Ключи служебных вкладок, чьё содержимое живёт вне дока. */
  virtualKeys: { agent: string; project: string };
}>();
const { fileOf, terminals, terminalPanels } = props.workbench;
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
      <PanelHost v-if="keepAlive.has(id)" :id="id" :registry="panelHosts" />
      <FilePanel
        v-else-if="fileOf(id)"
        :file="fileOf(id)!"
        :project-id="projectId"
        :revision="gutterRevision"
        @change="fileOf(id)!.draft = $event"
        @save="files.saveFile(fileOf(id))"
        @mode="fileOf(id)!.markdownMode = $event"
        @open="files.openFile($event)"
        @open-commit="files.openCommit($event)"
        @open-commit-diff="files.openCommitFile"
        @subject="fileOf(id)!.content = $event"
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
    <Teleport
      v-if="tabs.some((tab) => tab.virtual === 'agent')"
      :to="panelHosts.hosts[virtualKeys.agent] ?? null"
      :disabled="!panelHosts.hosts[virtualKeys.agent]"
    >
      <AgentChat :key="projectId" :project-id="projectId" />
    </Teleport>
    <Teleport
      v-if="tabs.some((tab) => tab.virtual === 'project')"
      :to="panelHosts.hosts[virtualKeys.project] ?? null"
      :disabled="!panelHosts.hosts[virtualKeys.project]"
    >
      <div class="project-settings"><slot name="project" /></div>
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
.project-settings {
  container-type: inline-size;
  height: 100%;
  overflow: auto;
  padding: var(--sp-4);
}
</style>
