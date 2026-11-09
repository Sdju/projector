<script setup lang="ts">
import UiHint from "../../../../../common/ui/UiHint.vue";
import UiSettingsSection from "../../../../../common/ui/UiSettingsSection.vue";
import { useAgentSkillsSettings } from "../model/skills-settings.ts";

const { data, error, commands } = useAgentSkillsSettings();
const activate = () => commands.scope.activate();
</script>

<template>
  <UiSettingsSection :activate="activate" :error="error">
    <UiHint v-if="!data.skills.length">Своих навыков и команд пока нет.</UiHint>
    <ul v-else class="skills">
      <li v-for="item in data.skills" :key="`${item.kind}:${item.name}`">
        <strong>{{ item.kind === "skill" ? item.name : `/${item.name}` }}</strong>
        <span v-if="item.hint"> {{ item.hint }}</span> — {{ item.description }}
      </li>
    </ul>
    <UiHint>
      Навык — папка <code>skills/&lt;имя&gt;/SKILL.md</code> с описанием в шапке
      (<code>description:</code>): агент видит описания и сам загружает нужный. Команда — файл
      <code>commands/&lt;имя&gt;.md</code>: её набирают как <code>/имя аргументы</code>, в тексте
      <code>$ARGUMENTS</code> заменяется аргументами. Папка пользователя:
      <code>{{ data.folders.find((item) => item.source === "user")?.path }}</code
      >; в проекте — <code>.projector/</code> с такими же подпапками; агенты со своей папкой навыков
      читают и её. Навык пользователя главнее одноимённого навыка проекта.
    </UiHint>
  </UiSettingsSection>
</template>
