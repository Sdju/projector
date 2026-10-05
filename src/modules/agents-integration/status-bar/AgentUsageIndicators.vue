<script setup lang="ts">
import { CodexUsageIndicator } from "../codex/index.ts";
import { OpenCodeUsageIndicator } from "../opencode/index.ts";
import { ClaudeUsageIndicator } from "../claude/index.ts";
import { CursorUsageIndicator } from "../cursor/index.ts";
</script>

<template>
  <CodexUsageIndicator />
  <OpenCodeUsageIndicator />
  <ClaudeUsageIndicator />
  <CursorUsageIndicator />
</template>
