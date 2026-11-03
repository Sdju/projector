<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import UiControl from "../../../common/ui/UiControl.vue";
import UiField from "../../../common/ui/UiField.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import { useAgentWebSettings } from "../model/web-settings.ts";

const { web, provider, url, apiKey, busy, error, commands } = useAgentWebSettings();
</script>

<template>
  <UiStack
    as="section"
    :gap="4"
    @focusin="commands.scope.activate()"
    @pointerdown="commands.scope.activate()"
  >
    <UiField v-slot="{ control }" label="поисковый сервис">
      <UiControl
        as="select"
        v-bind="control"
        aria-label="Поисковый сервис агента"
        v-model="provider"
        :disabled="busy"
      >
        <option value="brave">Brave Search (нужен ключ)</option>
        <option value="searxng">SearXNG (свой сервер)</option>
      </UiControl>
    </UiField>
    <UiField v-if="provider === 'searxng'" v-slot="{ control }" label="адрес SearXNG">
      <UiControl
        v-bind="control"
        aria-label="Адрес SearXNG"
        placeholder="https://searx.example.org"
        spellcheck="false"
        v-model="url"
        :disabled="busy"
      />
    </UiField>
    <UiField v-else v-slot="{ control }" label="ключ Brave Search">
      <UiControl
        v-bind="control"
        type="password"
        autocomplete="off"
        aria-label="Ключ Brave Search"
        :placeholder="web.hasKey ? 'ключ сохранён; введите новый, чтобы заменить' : 'ключ'"
        spellcheck="false"
        v-model="apiKey"
        :disabled="busy"
      />
    </UiField>
    <UiInline>
      <UiButton appearance="solid" :disabled="busy" @click="commands.run('ide.agent.web.set')"
        >Сохранить</UiButton
      >
      <UiButton
        v-if="web.hasKey && provider === 'brave'"
        :disabled="busy"
        @click="commands.run('ide.agent.web.key.clear')"
        >Удалить ключ</UiButton
      >
    </UiInline>
    <UiHint>
      Штатный агент ищет через <code>web_search</code> и читает страницы через
      <code>web_fetch</code>. Страницы из локальной сети ему недоступны, первое обращение к сайту
      подтверждаете вы. Всё, что приходит из интернета, агент считает чужими данными, а не
      указаниями. Ключ хранится в системном хранилище секретов; агент может сам попросить его
      отдельным закрытым полем.
    </UiHint>
    <UiMessage v-if="error" tone="danger" size="xs" flush role="alert">{{ error }}</UiMessage>
  </UiStack>
</template>
