<script setup lang="ts">
import { CodexUsageIndicator } from "../codex/index.ts";
import { OpenCodeUsageIndicator } from "../opencode/index.ts";
import { ClaudeUsageIndicator } from "../claude/index.ts";
import { CursorUsageIndicator } from "../cursor/index.ts";
import { ProviderBalanceIndicator } from "../provider/index.ts";
import { useAgentModes } from "../../agent/index.ts";

// Агенты, отключённые в настройках, не показывают лимиты и не опрашивают сервисы.
const { isEnabled } = useAgentModes();
</script>

<template>
  <CodexUsageIndicator v-if="isEnabled('codex')" />
  <OpenCodeUsageIndicator v-if="isEnabled('opencode')" />
  <ClaudeUsageIndicator v-if="isEnabled('claude')" />
  <CursorUsageIndicator v-if="isEnabled('cursor')" />
  <ProviderBalanceIndicator />
</template>
